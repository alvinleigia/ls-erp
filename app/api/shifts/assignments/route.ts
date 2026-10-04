import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const url = new URL(request.url)
  const searchParams = url.searchParams
  const staffIdsParam = searchParams.get("staffIds")?.trim()
  const startDate = searchParams.get("startDate")?.trim()
  const endDate = searchParams.get("endDate")?.trim()

  if (!startDate || !endDate) {
    const response = NextResponse.json({ error: "Start and end dates are required." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "missing_dates" })
    return withRequestId(response, logContext.requestId)
  }

  const staffIds = staffIdsParam
    ? staffIdsParam.split(",").map((value) => value.trim()).filter(Boolean)
    : []

  const staffProfiles = staffIds.length
      ? await prisma.staffProfile.findMany({
        where: { userId: { in: staffIds }, user: { tenantId } },
        select: { id: true, userId: true },
      })
    : []

  const staffProfileIds = staffProfiles.map((profile) => profile.id)
  const staffProfileMap = new Map(staffProfiles.map((profile) => [profile.id, profile.userId]))

  const rangeStart = new Date(startDate)
  const rangeEnd = new Date(endDate)

  try {
    const assignments = await prisma.staffScheduleAssignment.findMany({
      where: {
        ...(staffProfileIds.length ? { staffProfileId: { in: staffProfileIds } } : {}),
        schedule: { tenantId },
        startDate: { lte: rangeEnd },
        OR: [{ endDate: null }, { endDate: { gte: rangeStart } }],
      },
      include: {
        schedule: {
          include: {
            blocks: {
              orderBy: { sortOrder: "asc" },
              include: { template: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { startDate: "asc" },
    })

    const items = assignments.map((assignment) => ({
      ...assignment,
      staffId: staffProfileMap.get(assignment.staffProfileId) ?? null,
    }))

    const response = NextResponse.json({ items })
    logApiRequestSuccess(logContext, 200, { itemCount: items.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load assignments." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "read", actor => handleGET(request, actor), "assignments")
}
