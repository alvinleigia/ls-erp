import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent, recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { normalizeHistoryRangeToPast, syncRosterHistoryRange } from "@/modules/workforce/roster-history"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { canReadAppointmentDetails } from "@/modules/appointments/conflict-access"
import type { CreateLeaveRequestInput, ReviewLeaveRequestInput, BulkReviewLeaveRequestsInput, CancelLeaveRequestInput, RevokeLeaveRequestInput } from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { LeaveRequestRow } from "@/types/leaves"
import { notifyLeaveSubmitted, notifyLeaveReviewed, notifyLeaveCanceled, notifyLeaveRevoked } from "./leave-notifications"
import { scheduleTransaction } from "./schedule-transaction"
import { leaveRequestSelect, serializeLeaveRequest, validateCreateLeaveRequestRules, buildLeaveRequestRuleChecks, buildLeaveRequestTimeline, assertReviewTransitionAllowed, assertCancelTransitionAllowed, assertRevokeTransitionAllowed, findLeaveApprovalConflicts } from "./leave-requests"

// Called after module/action authorization, inside the API's tenant DB context.
function leaveActor(actor: BusinessActor) {
  if (!actor.tenantId || !actor.userId || !["ADMIN", "MANAGER", "STAFF"].includes(actor.role)) {
    throw new BusinessError(401, "Unauthorized")
  }
  return { tenantId: actor.tenantId, sessionUserId: actor.userId, role: actor.role,
    isAdmin: actor.role === "ADMIN", isManager: actor.role === "MANAGER", isStaff: actor.role === "STAFF" }
}

export class LeaveApprovalConflictError extends BusinessError {
  constructor(message: string, public conflicts: Awaited<ReturnType<typeof findLeaveApprovalConflicts>>, public blockedRequestIds?: string[]) {
    super(409, message)
  }
}

async function syncLeaveHistory(tx: Prisma.TransactionClient, tenantId: string, item: LeaveRequestRow) {
  const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const range = normalizeHistoryRangeToPast(item.startDate.slice(0, 10), item.endDate.slice(0, 10), setting?.timeZone ?? "UTC")
  if (range) await syncRosterHistoryRange(tx, {
    tenantId, staffProfileIds: [item.staffProfileId], ...range, mode: "replace",
  })
}

// Status, current record scope, booking conflicts, history and audit commit under
// the same lock as booking creation/moves. Notifications happen only after commit.
async function transitionLeaveRequest(actor: BusinessActor, id: string, status: LeaveRequestRow["status"], data: Prisma.LeaveRequestUncheckedUpdateManyInput, scope: Prisma.LeaveRequestWhereInput = {}) {
  const { tenantId, userId, role, requestId } = actor
  return scheduleTransaction(tenantId, async tx => {
    const where = { ...scope, tenantId, id, status }
    const current = await tx.leaveRequest.findFirst({ where, select: { id: true, staffProfileId: true, startDate: true, endDate: true } })
    if (!current) throw new BusinessError(409, "This leave request or its access changed. Refresh before trying again.")
    if (data.status === "APPROVED") {
      const conflicts = await findLeaveApprovalConflicts(tx, [current], tenantId)
      if (conflicts.length) throw new LeaveApprovalConflictError("Cannot approve leave request because active appointments overlap this date range.",
        await canReadAppointmentDetails(tenantId, userId, tx) ? conflicts : conflicts.map(item => ({ ...item, conflictingAppointments: [] })))
    }
    const changed = await tx.leaveRequest.updateMany({ where, data })
    if (changed.count !== 1) throw new BusinessError(409, "This leave request changed. Refresh before trying again.")
    const item = serializeLeaveRequest(await tx.leaveRequest.findFirstOrThrow({ where: { tenantId, id }, select: leaveRequestSelect }))
    await syncLeaveHistory(tx, tenantId, item)
    const action = item.status === "CANCELED" ? "canceled" : item.status === "REVOKED" ? "revoked" : "reviewed"
    const after = action === "canceled" ? { status: item.status, canceledAt: item.canceledAt, cancelReason: item.cancelReason }
      : action === "revoked" ? { status: item.status, revokedAt: item.revokedAt, revokeReason: item.revokeReason }
      : { status: item.status, reviewedAt: item.reviewedAt }
    await recordDomainAuditEvent(tx, { tenantId, actorUserId: userId, actorRole: role, requestId,
      event: `leave.request.${action}`, entityType: "LeaveRequest", entityId: id, before: { status }, after,
      ...(action === "reviewed" ? { metadata: { reviewerComment: item.reviewerComment } } : {}) })
    return item
  })
}

const leaveRequestStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELED", "REVOKED"])

export const leaveRequestListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: leaveRequestStatusSchema.optional(),
  leaveDefinitionId: z.string().trim().min(1).optional(),
  mineOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  staffUserId: z.string().trim().min(1).optional(),
  sort: z
    .enum(["startDate", "endDate", "status", "daysCount", "createdAt", "updatedAt"])
    .default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
})


export async function listLeaveRequests(actor: BusinessActor, input: z.infer<typeof leaveRequestListSchema>): Promise<ListResponse<LeaveRequestRow>> {
  const { tenantId, sessionUserId, isStaff, isManager } = leaveActor(actor)
  let actorStaffProfile = await prisma.staffProfile.findFirst({
    where: { userId: sessionUserId, user: { tenantId } },
    select: { id: true },
  })
  if ((isStaff || isManager) && !actorStaffProfile) {
    actorStaffProfile = await prisma.staffProfile.create({
      data: { userId: sessionUserId },
      select: { id: true },
    })
  }

  const { page, pageSize, q, status, leaveDefinitionId, mineOnly, staffUserId, sort, order } =
    input

  let staffProfileFilterId: string | undefined
  if (isStaff) {
    if (!actorStaffProfile) {
      throw new BusinessError(400, "Staff profile not found.")
    }
    staffProfileFilterId = actorStaffProfile.id
  } else if (mineOnly) {
    if (!actorStaffProfile) {
      throw new BusinessError(400, "Staff profile not found for mine-only filter.")
    }
    staffProfileFilterId = actorStaffProfile.id
  } else if (staffUserId) {
    const selectedStaffProfile = await prisma.staffProfile.findFirst({
      where: { userId: staffUserId, user: { tenantId } },
      select: { id: true },
    })
    if (!selectedStaffProfile) {
      throw new BusinessError(404, "Selected staff user not found.")
    }
    staffProfileFilterId = selectedStaffProfile.id
  }

  const where: Prisma.LeaveRequestWhereInput = {
    tenantId,
    ...(isManager && !mineOnly
      ? {
          staffProfile: {
            managerUserId: sessionUserId,
            user: { role: "STAFF" },
          },
        }
      : {}),
    ...(status ? { status } : {}),
    ...(leaveDefinitionId ? { leaveDefinitionId } : {}),
    ...(staffProfileFilterId ? { staffProfileId: staffProfileFilterId } : {}),
    ...(q
      ? {
          OR: [
            { reason: { contains: q, mode: "insensitive" } },
            { leaveDefinition: { code: { contains: q, mode: "insensitive" } } },
            { leaveDefinition: { name: { contains: q, mode: "insensitive" } } },
            { staffProfile: { user: { name: { contains: q, mode: "insensitive" } } } },
            { staffProfile: { user: { email: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sort]: order },
      select: leaveRequestSelect,
    }),
  ])

  const response: ListResponse<LeaveRequestRow> = {
    items: items.map(serializeLeaveRequest),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
  return response
}

export async function submitLeaveRequest(actor: BusinessActor, input: CreateLeaveRequestInput) {
  const { tenantId, sessionUserId, role, isManager, isStaff } = leaveActor(actor)
  if (!isManager && !isStaff) throw new BusinessError(401, "Unauthorized")
  const staffProfile = await prisma.staffProfile.findFirst({
    where: { userId: sessionUserId, user: { tenantId } },
    select: { id: true },
  })
  const resolvedStaffProfile =
    staffProfile ??
    (await prisma.staffProfile.create({
      data: { userId: sessionUserId },
      select: { id: true },
    }))
  if (!resolvedStaffProfile) {
    throw new BusinessError(400, "Staff profile not found.")
  }
  const item = await prisma.$transaction(async (tx) => {
    const validated = await validateCreateLeaveRequestRules({
      tx,
      tenantId,
      staffProfileId: resolvedStaffProfile.id,
      leaveDefinitionId: input.leaveDefinitionId,
      startDate: input.startDate,
      endDate: input.endDate,
    })

    const created = await tx.leaveRequest.create({
      data: {
        tenantId,
        staffProfileId: resolvedStaffProfile.id,
        leaveDefinitionId: input.leaveDefinitionId,
        startDate: validated.startDate,
        endDate: validated.endDate,
        daysCount: validated.daysCount,
        reason: input.reason?.trim() || null,
        status: "PENDING",
      },
    })

    return tx.leaveRequest.findFirstOrThrow({
      where: { id: created.id, tenantId },
      select: leaveRequestSelect,
    })
  })

  const serialized = serializeLeaveRequest(item)
  void notifyLeaveSubmitted(prisma, {
    tenantId,
    staffUserId: serialized.staff.userId,
    leaveCode: serialized.leaveDefinition.code,
    leaveName: serialized.leaveDefinition.name,
    startDateIso: serialized.startDate.slice(0, 10),
    endDateIso: serialized.endDate.slice(0, 10),
    daysCount: serialized.daysCount,
  })
  await recordDomainAuditEventSafe(prisma, {
    tenantId,
    event: "leave.request.submitted",
    entityType: "LeaveRequest",
    entityId: serialized.id,
    actorUserId: sessionUserId,
    actorRole: role ?? null,
    requestId: actor.requestId,
    metadata: {
      leaveDefinitionId: serialized.leaveDefinition.id,
      leaveDefinitionCode: serialized.leaveDefinition.code,
      daysCount: serialized.daysCount,
    },
    after: {
      status: serialized.status,
      startDate: serialized.startDate,
      endDate: serialized.endDate,
      reason: serialized.reason,
    },
  })
  return { item: serialized }
}

export async function getLeaveRequest(actor: BusinessActor, id: string, includeRuleChecks: boolean) {
  const { tenantId, sessionUserId, isAdmin, isManager } = leaveActor(actor)
  const item = await prisma.leaveRequest.findFirst({
    where: { id, tenantId }, select: leaveRequestSelect,
  })
  if (!item) throw new BusinessError(404, "Leave request not found.")

  const isOwner = item.staffProfile.user.id === sessionUserId
  const isAssignedManager =
    isManager &&
    item.staffProfile.user.role === "STAFF" &&
    item.staffProfile.managerUserId === sessionUserId
  if (!isAdmin && !isOwner && !isAssignedManager) throw new BusinessError(403, "Unauthorized")

  const serializedItem = serializeLeaveRequest(item)
  if (!includeRuleChecks) return { item: serializedItem }

  const leaveDefinition = await prisma.leaveDefinition.findFirst({
    where: { id: item.leaveDefinitionId, tenantId },
    select: {
      allowedUsers: true,
      minDaysPerRequest: true,
      maxDaysPerRequest: true,
      priorEntryAllowed: true,
      noticeDays: true,
      weekOffSingleSideAllowed: true,
      weekOffBothSideAllowed: true,
      holidaySingleSideAllowed: true,
      holidayBothSideAllowed: true,
    },
  })
  if (!leaveDefinition) throw new BusinessError(404, "Leave definition not found.")

  const staff = await prisma.staffProfile.findFirst({
    where: { id: item.staffProfileId, user: { tenantId } },
    select: {
      user: {
        select: {
          gender: true,
        },
      },
    },
  })

  const ruleChecks = await buildLeaveRequestRuleChecks({
    tx: prisma,
    tenantId,
    staffProfileId: item.staffProfileId,
    staffGender: staff?.user.gender ?? null,
    leaveDefinition,
    startDate: item.startDate,
    endDate: item.endDate,
    createdAt: item.createdAt,
  })
  const timeline = buildLeaveRequestTimeline({
    createdAt: item.createdAt,
    staffName: item.staffProfile.user.name,
    staffEmail: item.staffProfile.user.email,
    reviewedAt: item.reviewedAt,
    reviewedByName: item.reviewedByUser?.name ?? null,
    reviewedByEmail: item.reviewedByUser?.email ?? null,
    reviewerComment: item.reviewerComment,
    canceledAt: item.canceledAt,
    cancelReason: item.cancelReason,
    revokedAt: item.revokedAt,
    revokedByName: item.revokedByUser?.name ?? null,
    revokedByEmail: item.revokedByUser?.email ?? null,
    revokeReason: item.revokeReason,
  })
  return { item: serializedItem, ruleChecks, timeline }
}

export async function reviewLeaveRequest(actor: BusinessActor, id: string, input: ReviewLeaveRequestInput) {
  const { tenantId, sessionUserId, role } = leaveActor(actor)
  if (role !== "ADMIN" && role !== "MANAGER") throw new BusinessError(401, "Unauthorized")
  const reviewer = await prisma.user.findFirst({ where: { id: sessionUserId, tenantId }, select: { id: true } })
  if (!reviewer) throw new BusinessError(401, "Session user not found. Please sign in again.")
  const current = await prisma.leaveRequest.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      staffProfileId: true,
      startDate: true,
      endDate: true,
      status: true,
      staffProfile: {
        select: {
          managerUserId: true,
          user: {
            select: { role: true },
          },
        },
      },
    },
  })
  if (!current) {
    throw new BusinessError(404, "Leave request not found.")
  }
  if (role === "MANAGER" && current.staffProfile.user.role !== "STAFF") {
    throw new BusinessError(403, "Managers can only review staff leave requests.")
  }
  if (role === "MANAGER" && current.staffProfile.managerUserId !== reviewer.id) {
    throw new BusinessError(403, "You can only review requests for your assigned staff.")
  }

  assertReviewTransitionAllowed(current.status)

  const serialized = await transitionLeaveRequest(actor, current.id, current.status, {
      status: input.status,
      reviewedByUserId: reviewer.id,
      reviewedAt: new Date(),
      reviewerComment: input.reviewerComment?.trim() || null,
    }, role === "MANAGER" ? { staffProfile: { managerUserId: sessionUserId, user: { role: "STAFF" } } } : {})
  void notifyLeaveReviewed(prisma, {
    tenantId,
    staffUserId: serialized.staff.userId,
    status: input.status,
    reviewerName: serialized.reviewedBy?.name ?? null,
    reviewerComment: serialized.reviewerComment,
    leaveCode: serialized.leaveDefinition.code,
    leaveName: serialized.leaveDefinition.name,
    startDateIso: serialized.startDate.slice(0, 10),
    endDateIso: serialized.endDate.slice(0, 10),
    daysCount: serialized.daysCount,
  })

  return { item: serialized }
}

export async function cancelLeaveRequest(actor: BusinessActor, id: string, input: CancelLeaveRequestInput) {
  const { tenantId, sessionUserId, isAdmin, isManager } = leaveActor(actor)
  const current = await prisma.leaveRequest.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      status: true,
      staffProfile: {
        select: {
          managerUserId: true,
          user: {
            select: {
              role: true,
            },
          },
          userId: true,
        },
      },
    },
  })
  if (!current) {
    throw new BusinessError(404, "Leave request not found.")
  }

  const isOwner = current.staffProfile.userId === sessionUserId
  const canAdminCancel = isAdmin
  const isAssignedManager =
    isManager &&
    current.staffProfile.user.role === "STAFF" &&
    current.staffProfile.managerUserId === sessionUserId
  if (!isOwner && !canAdminCancel && !isAssignedManager) {
    throw new BusinessError(401, "Unauthorized")
  }

  assertCancelTransitionAllowed(current.status)

  const serialized = await transitionLeaveRequest(actor, current.id, current.status, {
      status: "CANCELED",
      canceledAt: new Date(),
      cancelReason: input.cancelReason?.trim() || null,
    }, isAdmin ? {} : { staffProfile: isOwner ? { userId: sessionUserId } : { managerUserId: sessionUserId, user: { role: "STAFF" } } })
  const canceledBy = await prisma.user.findFirst({
    where: { id: sessionUserId, tenantId },
    select: { name: true },
  })
  void notifyLeaveCanceled(prisma, {
    tenantId,
    staffUserId: serialized.staff.userId,
    canceledByUserId: sessionUserId,
    canceledByName: canceledBy?.name ?? null,
    cancelReason: serialized.cancelReason,
    leaveCode: serialized.leaveDefinition.code,
    leaveName: serialized.leaveDefinition.name,
    startDateIso: serialized.startDate.slice(0, 10),
    endDateIso: serialized.endDate.slice(0, 10),
    daysCount: serialized.daysCount,
  })

  return { item: serialized }
}

export async function revokeLeaveRequest(actor: BusinessActor, id: string, input: RevokeLeaveRequestInput) {
  const { tenantId, sessionUserId, role, isManager } = leaveActor(actor)
  if (role !== "ADMIN" && role !== "MANAGER") throw new BusinessError(401, "Unauthorized")
  const current = await prisma.leaveRequest.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      status: true,
      staffProfile: {
        select: {
          managerUserId: true,
          user: {
            select: {
              role: true,
            },
          },
        },
      },
    },
  })
  if (!current) {
    throw new BusinessError(404, "Leave request not found.")
  }
  if (
    isManager &&
    (current.staffProfile.user.role !== "STAFF" ||
      current.staffProfile.managerUserId !== sessionUserId)
  ) {
    throw new BusinessError(403, "You can only revoke approved requests for your assigned staff.")
  }

  assertRevokeTransitionAllowed(current.status)

  const serialized = await transitionLeaveRequest(actor, current.id, current.status, {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedByUserId: sessionUserId,
      revokeReason: input.revokeReason.trim(),
    }, isManager ? { staffProfile: { managerUserId: sessionUserId, user: { role: "STAFF" } } } : {})

  void notifyLeaveRevoked(prisma, {
    tenantId,
    staffUserId: serialized.staff.userId,
    revokedByName: null,
    revokeReason: serialized.revokeReason,
    leaveCode: serialized.leaveDefinition.code,
    leaveName: serialized.leaveDefinition.name,
    startDateIso: serialized.startDate.slice(0, 10),
    endDateIso: serialized.endDate.slice(0, 10),
    daysCount: serialized.daysCount,
  })

  return { item: serialized }
}

export async function bulkReviewLeaveRequests(actor: BusinessActor, input: BulkReviewLeaveRequestsInput) {
  const { tenantId, sessionUserId, role } = leaveActor(actor)
  if (role !== "ADMIN" && role !== "MANAGER") throw new BusinessError(401, "Unauthorized")
  const reviewer = await prisma.user.findFirst({ where: { tenantId, id: sessionUserId }, select: { id: true } })
  if (!reviewer) throw new BusinessError(401, "Session user not found. Please sign in again.")
  const { requestIds, status, reviewerComment } = input
  const eligibleWhere: Prisma.LeaveRequestWhereInput = {
    tenantId, id: { in: requestIds }, status: "PENDING",
    ...(role === "MANAGER" ? { staffProfile: { managerUserId: reviewer.id, user: { role: "STAFF" } } } : {}),
  }
  const pending = await prisma.leaveRequest.findMany({
    where: eligibleWhere,
    select: { id: true, staffProfileId: true, startDate: true, endDate: true },
  })
  if (!pending.length) return { items: [], updatedCount: 0, skippedCount: requestIds.length, skippedIds: requestIds }
  const items = await scheduleTransaction(tenantId, async tx => {
    const eligible = await tx.leaveRequest.findMany({ where: { ...eligibleWhere, id: { in: pending.map(item => item.id) } },
      select: { id: true, staffProfileId: true, startDate: true, endDate: true } })
    if (status === "APPROVED" && eligible.length) {
      const conflicts = await findLeaveApprovalConflicts(tx, eligible, tenantId)
      if (conflicts.length) throw new LeaveApprovalConflictError("Cannot approve selected leave requests because active appointments overlap.",
        await canReadAppointmentDetails(tenantId, sessionUserId, tx) ? conflicts : conflicts.map(item => ({ ...item, conflictingAppointments: [] })),
        conflicts.map(item => item.requestId))
    }
    // Return exactly the rows changed by this action, excluding concurrent reviews
    // or cancellations. Do not reread all candidate IDs and report them as updated.
    const changed = await tx.leaveRequest.updateManyAndReturn({
      where: { ...eligibleWhere, id: { in: eligible.map(item => item.id) } },
      data: { status, reviewedByUserId: reviewer.id, reviewedAt: new Date(), reviewerComment: reviewerComment?.trim() || null },
      select: { id: true },
    })
    const rows = await tx.leaveRequest.findMany({
      where: { tenantId, id: { in: changed.map(item => item.id) } }, select: leaveRequestSelect,
    })
    const serialized = rows.map(serializeLeaveRequest)
    for (const item of serialized) await syncLeaveHistory(tx, tenantId, item)
    if (serialized.length) await recordDomainAuditEvent(tx, {
      tenantId, event: "leave.request.bulk_reviewed", entityType: "LeaveRequest",
      actorUserId: reviewer.id, actorRole: role, requestId: actor.requestId,
      metadata: { status, updatedCount: serialized.length, skippedCount: requestIds.length - serialized.length, requestIds: serialized.map(item => item.id) },
    })
    return serialized
  })
  const changedIds = new Set(items.map(item => item.id))
  const skippedIds = requestIds.filter(id => !changedIds.has(id))
  for (const item of items) {
    void notifyLeaveReviewed(prisma, {
      tenantId, staffUserId: item.staff.userId, status,
      reviewerName: item.reviewedBy?.name ?? null, reviewerComment: item.reviewerComment,
      leaveCode: item.leaveDefinition.code, leaveName: item.leaveDefinition.name,
      startDateIso: item.startDate.slice(0, 10), endDateIso: item.endDate.slice(0, 10), daysCount: item.daysCount,
    })
  }
  return { items, updatedCount: items.length, skippedCount: skippedIds.length, skippedIds }
}
