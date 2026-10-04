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
import { reviewLeaveRequestSchema } from "@/lib/validation"
import { notifyLeaveReviewed } from "../../../_notifications"
import {
  assertReviewTransitionAllowed,
  findLeaveApprovalConflicts,
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
    const parsed = reviewLeaveRequestSchema.safeParse(payload)
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
      const response = NextResponse.json({ error: "Leave request not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }
    if (role === "MANAGER" && current.staffProfile.user.role !== "STAFF") {
      const response = NextResponse.json(
        { error: "Managers can only review staff leave requests." },
        { status: 403 }
      )
      logApiRequestSuccess(logContext, 403, { reason: "manager_review_scope_violation", itemId: id })
      return withRequestId(response, logContext.requestId)
    }
    if (role === "MANAGER" && current.staffProfile.managerUserId !== reviewer.id) {
      const response = NextResponse.json(
        { error: "You can only review requests for your assigned staff." },
        { status: 403 }
      )
      logApiRequestSuccess(logContext, 403, { reason: "not_assigned_manager", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

    assertReviewTransitionAllowed(current.status)
    if (parsed.data.status === "APPROVED") {
      const conflicts = await findLeaveApprovalConflicts(prisma, [
        {
          id: current.id,
          staffProfileId: current.staffProfileId,
          startDate: current.startDate,
          endDate: current.endDate,
        },
      ], tenantId)
      if (conflicts.length > 0) {
        const response = NextResponse.json(
          {
            error: "Cannot approve leave request because active appointments overlap this date range.",
            conflicts: await canReadAppointmentDetails(tenantId, sessionUserId) ? conflicts : conflicts.map(item => ({ ...item, conflictingAppointments: [] })),
          },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "approval_conflicts", conflictCount: conflicts.length, itemId: id })
        return withRequestId(response, logContext.requestId)
      }
    }

    const item = await prisma.leaveRequest.update({
      where: { id: current.id },
      data: {
        status: parsed.data.status,
        reviewedByUserId: reviewer.id,
        reviewedAt: new Date(),
        reviewerComment: parsed.data.reviewerComment?.trim() || null,
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
    void notifyLeaveReviewed(prisma, {
      staffUserId: serialized.staff.userId,
      status: parsed.data.status,
      reviewerName: serialized.reviewedBy?.name ?? null,
      reviewerComment: serialized.reviewerComment,
      leaveCode: serialized.leaveDefinition.code,
      leaveName: serialized.leaveDefinition.name,
      startDateIso: serialized.startDate.slice(0, 10),
      endDateIso: serialized.endDate.slice(0, 10),
      daysCount: serialized.daysCount,
    })
    await recordDomainAuditEventSafe(prisma, {
      tenantId,
      event: "leave.request.reviewed",
      entityType: "LeaveRequest",
      entityId: serialized.id,
      actorUserId: reviewer.id,
      actorRole: role ?? null,
      requestId: logContext.requestId,
      metadata: {
        reviewerComment: parsed.data.reviewerComment?.trim() || null,
      },
      before: {
        status: current.status,
      },
      after: {
        status: serialized.status,
        reviewedAt: serialized.reviewedAt,
      },
    })

    const response = NextResponse.json({ item: serialized })
    logApiRequestSuccess(logContext, 200, { itemId: id, status: parsed.data.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to review leave request." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveApprovals", "approve", actor => handlePATCH(request, context, actor), "requests/[id]/review", (await context.params).id)
}
