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
  buildLeaveRequestRuleChecks,
  buildLeaveRequestTimeline,
  leaveRequestSelect,
  serializeLeaveRequest,
} from "../../_requests"

async function handleGET(
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
    const { id } = await params
    const includeRuleChecks =
      new URL(request.url).searchParams.get("includeRuleChecks") === "true"
    const item = await prisma.leaveRequest.findFirst({
      where: { id, tenantId },
      select: leaveRequestSelect,
    })
    if (!item) {
      const response = NextResponse.json({ error: "Leave request not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

  const isOwner = item.staffProfile.user.id === sessionUserId
  const isAssignedManager =
    isManager &&
    item.staffProfile.user.role === "STAFF" &&
    item.staffProfile.managerUserId === sessionUserId
    if (!isAdmin && !isOwner && !isAssignedManager) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 403 })
      logApiRequestSuccess(logContext, 403, { reason: "forbidden", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

    const serializedItem = serializeLeaveRequest(item)
    if (!includeRuleChecks) {
      const response = NextResponse.json({ item: serializedItem })
      logApiRequestSuccess(logContext, 200, { itemId: id, includeRuleChecks: false })
      return withRequestId(response, logContext.requestId)
    }

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
    if (!leaveDefinition) {
      const response = NextResponse.json({ error: "Leave definition not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "leave_definition_not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

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

    const response = NextResponse.json({ item: serializedItem, ruleChecks, timeline })
    logApiRequestSuccess(logContext, 200, { itemId: id, includeRuleChecks: true })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave request." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "read", actor => handleGET(request, context, actor), "requests/[id]", (await context.params).id)
}
