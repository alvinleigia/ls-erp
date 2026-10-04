import { canReadAppointmentDetails } from "@/modules/appointments/conflict-access"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import {
  normalizeHistoryRangeToPast,
  syncRosterHistoryRange,
} from "@/lib/roster-history"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { bulkReviewLeaveRequestsSchema } from "@/lib/validation"
import { notifyLeaveReviewed } from "../../_notifications"
import {
  findLeaveApprovalConflicts,
  leaveRequestSelect,
  serializeLeaveRequest,
} from "../../_requests"

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId } = tenantSession.context
  const role = tenantSession.context.role as Role | undefined
  const sessionUserId = tenantSession.context.sessionUserId
  if (!canManageUsers(role ?? null)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }
  if (!sessionUserId) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "missing_session_user_id" })
    return withRequestId(response, logContext.requestId)
  }
  const reviewerById = await prisma.user.findFirst({
    where: { id: sessionUserId, tenantId },
    select: { id: true },
  })
  const reviewer = reviewerById
  if (!reviewer) {
    const response = NextResponse.json(
      { error: "Session user not found. Please sign in again." },
      { status: 401 }
    )
    logApiRequestSuccess(logContext, 401, { reason: "reviewer_not_found" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const payload = await request.json().catch(() => ({}))
    const parsed = bulkReviewLeaveRequestsSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const { requestIds, status, reviewerComment } = parsed.data
    const now = new Date()
    const currentItems = await prisma.leaveRequest.findMany({
      where: { tenantId, id: { in: requestIds } },
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
    const pendingIds = currentItems
      .filter((item) => item.status === "PENDING")
      .filter((item) =>
        role === "MANAGER"
          ? item.staffProfile.user.role === "STAFF" && item.staffProfile.managerUserId === reviewer.id
          : true
      )
      .map((item) => item.id)
    const skippedIds = requestIds.filter((id) => !pendingIds.includes(id))

    if (pendingIds.length === 0) {
      const response = NextResponse.json({
        items: [],
        updatedCount: 0,
        skippedCount: skippedIds.length,
        skippedIds,
      })
      logApiRequestSuccess(logContext, 200, { updatedCount: 0, skippedCount: skippedIds.length })
      return withRequestId(response, logContext.requestId)
    }

    if (status === "APPROVED") {
      const conflicts = await findLeaveApprovalConflicts(
        prisma,
        currentItems
          .filter((item) => pendingIds.includes(item.id))
          .map((item) => ({
            id: item.id,
            staffProfileId: item.staffProfileId,
            startDate: item.startDate,
            endDate: item.endDate,
          })),
        tenantId
      )
      if (conflicts.length > 0) {
        const response = NextResponse.json(
          {
            error: "Cannot approve selected leave requests because active appointments overlap.",
            conflicts: await canReadAppointmentDetails(tenantId, sessionUserId) ? conflicts : conflicts.map(item => ({ ...item, conflictingAppointments: [] })),
            blockedRequestIds: conflicts.map((item) => item.requestId),
          },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "approval_conflicts", conflictCount: conflicts.length })
        return withRequestId(response, logContext.requestId)
      }
    }

    await prisma.leaveRequest.updateMany({
      where: { tenantId, id: { in: pendingIds }, status: "PENDING" },
      data: {
        status,
        reviewedByUserId: reviewer.id,
        reviewedAt: now,
        reviewerComment: reviewerComment?.trim() || null,
      },
    })

  const updatedItems = await prisma.leaveRequest.findMany({
    where: { tenantId, id: { in: pendingIds } },
    select: leaveRequestSelect,
  })
  const serializedItems = updatedItems.map(serializeLeaveRequest)
  for (const item of serializedItems) {
    const normalizedPastRange = normalizeHistoryRangeToPast(
      item.startDate.slice(0, 10),
      item.endDate.slice(0, 10)
    )
    if (!normalizedPastRange) continue
    await syncRosterHistoryRange(prisma, {
      staffProfileIds: [item.staffProfileId],
      startDate: normalizedPastRange.startDate,
      endDate: normalizedPastRange.endDate,
      mode: "replace",
      tenantId,
    })
  }
  for (const item of serializedItems) {
    void notifyLeaveReviewed(prisma, {
      staffUserId: item.staff.userId,
      status,
      reviewerName: item.reviewedBy?.name ?? null,
      reviewerComment: item.reviewerComment,
      leaveCode: item.leaveDefinition.code,
      leaveName: item.leaveDefinition.name,
      startDateIso: item.startDate.slice(0, 10),
      endDateIso: item.endDate.slice(0, 10),
      daysCount: item.daysCount,
    })
  }
  await recordDomainAuditEventSafe(prisma, {
      tenantId,
    event: "leave.request.bulk_reviewed",
    entityType: "LeaveRequest",
    actorUserId: reviewer.id,
    actorRole: role ?? null,
    requestId: logContext.requestId,
    metadata: {
      status,
      updatedCount: serializedItems.length,
      skippedCount: skippedIds.length,
      requestIds: pendingIds,
    },
  })

    const response = NextResponse.json({
      items: serializedItems,
      updatedCount: serializedItems.length,
      skippedCount: skippedIds.length,
      skippedIds,
    })
    logApiRequestSuccess(logContext, 200, {
      updatedCount: serializedItems.length,
      skippedCount: skippedIds.length,
      status,
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to bulk review leave requests." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveApprovals", "approve", actor => handlePOST(request, actor), "requests/review-bulk")
}
