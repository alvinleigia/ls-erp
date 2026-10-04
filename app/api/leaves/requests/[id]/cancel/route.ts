import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import type { Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import {
  normalizeHistoryRangeToPast,
  syncRosterHistoryRange,
} from "@/lib/roster-history"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { cancelLeaveRequestSchema } from "@/lib/validation"
import { notifyLeaveCanceled } from "../../../_notifications"
import {
  assertCancelTransitionAllowed,
  leaveRequestSelect,
  serializeLeaveRequest,
} from "../../../_requests"

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
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

  try {
    const payload = await request.json().catch(() => ({}))
    const parsed = cancelLeaveRequestSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const { id } = await params
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
      const response = NextResponse.json({ error: "Leave request not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

    const isOwner = current.staffProfile.userId === sessionUserId
    const canAdminCancel = isAdmin
    const isAssignedManager =
      isManager &&
      current.staffProfile.user.role === "STAFF" &&
      current.staffProfile.managerUserId === sessionUserId
    if (!isOwner && !canAdminCancel && !isAssignedManager) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      logApiRequestSuccess(logContext, 401, { reason: "forbidden_cancel", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

    assertCancelTransitionAllowed(current.status)

    const item = await prisma.leaveRequest.update({
      where: { id: current.id },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        cancelReason: parsed.data.cancelReason?.trim() || null,
      },
      select: leaveRequestSelect,
    })

    const serialized = serializeLeaveRequest(item)
    const normalizedPastRange = normalizeHistoryRangeToPast(
      serialized.startDate.slice(0, 10),
      serialized.endDate.slice(0, 10)
    )
    if (normalizedPastRange) {
      await syncRosterHistoryRange(prisma, {
        staffProfileIds: [serialized.staffProfileId],
        startDate: normalizedPastRange.startDate,
        endDate: normalizedPastRange.endDate,
        mode: "replace",
        tenantId,
      })
    }
    const actor = await prisma.user.findFirst({
      where: { id: sessionUserId, tenantId },
      select: { name: true },
    })
    void notifyLeaveCanceled(prisma, {
      staffUserId: serialized.staff.userId,
      canceledByUserId: sessionUserId,
      canceledByName: actor?.name ?? null,
      cancelReason: serialized.cancelReason,
      leaveCode: serialized.leaveDefinition.code,
      leaveName: serialized.leaveDefinition.name,
      startDateIso: serialized.startDate.slice(0, 10),
      endDateIso: serialized.endDate.slice(0, 10),
      daysCount: serialized.daysCount,
    })
    await recordDomainAuditEventSafe(prisma, {
      tenantId,
      event: "leave.request.canceled",
      entityType: "LeaveRequest",
      entityId: serialized.id,
      actorUserId: sessionUserId,
      actorRole: role ?? null,
      requestId: logContext.requestId,
      before: {
        status: current.status,
      },
      after: {
        status: serialized.status,
        canceledAt: serialized.canceledAt,
        cancelReason: serialized.cancelReason,
      },
    })

    const response = NextResponse.json({ item: serialized })
    logApiRequestSuccess(logContext, 200, { itemId: id, status: "CANCELED" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to cancel leave request." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "archive", actor => handlePATCH(request, context, actor), "requests/[id]/cancel", (await context.params).id)
}
