import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import type { Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import { createLeaveRequestSchema } from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { LeaveRequestRow } from "@/types/leaves"
import { notifyLeaveSubmitted } from "../_notifications"
import {
  leaveRequestSelect,
  serializeLeaveRequest,
  validateCreateLeaveRequestRules,
} from "../_requests"

const leaveRequestStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELED", "REVOKED"])

const leaveRequestListSchema = z.object({
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

async function handleGET(request: Request, actor: BusinessActor) {
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
  const isAdmin = role === "ADMIN"
  const isManager = role === "MANAGER"
  const isStaff = role === "STAFF"
  if (!isAdmin && !isManager && !isStaff) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }
  if (!sessionUserId) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "missing_session_user_id" })
    return withRequestId(response, logContext.requestId)
  }

  const parsed = leaveRequestListSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  )
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid query parameters.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
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
      parsed.data

    let staffProfileFilterId: string | undefined
    if (isStaff) {
      if (!actorStaffProfile) {
        const response = NextResponse.json({ error: "Staff profile not found." }, { status: 400 })
        logApiRequestSuccess(logContext, 400, { reason: "staff_profile_not_found" })
        return withRequestId(response, logContext.requestId)
      }
      staffProfileFilterId = actorStaffProfile.id
    } else if (mineOnly) {
      if (!actorStaffProfile) {
        const response = NextResponse.json({ error: "Staff profile not found for mine-only filter." }, { status: 400 })
        logApiRequestSuccess(logContext, 400, { reason: "mine_only_staff_profile_not_found" })
        return withRequestId(response, logContext.requestId)
      }
      staffProfileFilterId = actorStaffProfile.id
    } else if (staffUserId) {
      const selectedStaffProfile = await prisma.staffProfile.findFirst({
        where: { userId: staffUserId, user: { tenantId } },
        select: { id: true },
      })
      if (!selectedStaffProfile) {
        const response = NextResponse.json({ error: "Selected staff user not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "selected_staff_not_found" })
        return withRequestId(response, logContext.requestId)
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
    const json = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(json, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave requests." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

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
  const isManager = role === "MANAGER"
  const isStaff = role === "STAFF"
  if (!isManager && !isStaff) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }
  if (!sessionUserId) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "missing_session_user_id" })
    return withRequestId(response, logContext.requestId)
  }

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
    const response = NextResponse.json({ error: "Staff profile not found." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "staff_profile_not_found" })
    return withRequestId(response, logContext.requestId)
  }

  const payload = await request.json().catch(() => ({}))
  const parsed = createLeaveRequestSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const item = await prisma.$transaction(async (tx) => {
      const validated = await validateCreateLeaveRequestRules({
        tx,
        tenantId,
        staffProfileId: resolvedStaffProfile.id,
        leaveDefinitionId: parsed.data.leaveDefinitionId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      })

      const created = await tx.leaveRequest.create({
        data: {
          tenantId,
          staffProfileId: resolvedStaffProfile.id,
          leaveDefinitionId: parsed.data.leaveDefinitionId,
          startDate: validated.startDate,
          endDate: validated.endDate,
          daysCount: validated.daysCount,
          reason: parsed.data.reason?.trim() || null,
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
      requestId: logContext.requestId,
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

    const response = NextResponse.json({ item: serialized }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { leaveRequestId: serialized.id, status: serialized.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Error) {
      logApiRequestError(logContext, error, 400)
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create leave request." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "create", actor => handlePOST(request, actor), "requests")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "read", actor => handleGET(request, actor), "requests")
}
