import { NextResponse } from "next/server"
import { z } from "zod"

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
import type { LeaveRosterItem } from "@/types/leaves"

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffIds: z.string().optional(),
})

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers((role as Role | null) ?? null)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const parsed = querySchema.safeParse(
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

    const { startDate, endDate, staffIds } = parsed.data
    if (startDate > endDate) {
      const response = NextResponse.json(
        { error: "Start date cannot be after end date." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
      return withRequestId(response, logContext.requestId)
    }

    const staffUserIds = (staffIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    const staffProfiles = staffUserIds.length
      ? await prisma.staffProfile.findMany({
          where: { userId: { in: staffUserIds }, user: { tenantId } },
          select: { id: true },
        })
      : []
    const staffProfileIds = staffProfiles.map((profile) => profile.id)

    const items = await prisma.leaveRequest.findMany({
      where: {
        tenantId,
        status: "APPROVED",
        startDate: { lte: new Date(`${endDate}T00:00:00.000Z`) },
        endDate: { gte: new Date(`${startDate}T00:00:00.000Z`) },
        ...(staffUserIds.length ? { staffProfileId: { in: staffProfileIds } } : {}),
        ...(actor.role === "MANAGER" ? { staffProfile: { managerUserId: actor.userId, user: { role: "STAFF" } } } : {}),
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        reason: true,
        leaveDefinition: {
          select: {
            code: true,
            name: true,
          },
        },
        staffProfile: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    })

    const response: LeaveRosterItem[] = items.map((item) => ({
      id: item.id,
      staffId: item.staffProfile.user.id,
      staffName: item.staffProfile.user.name,
      staffEmail: item.staffProfile.user.email,
      leaveDefinitionCode: item.leaveDefinition.code,
      leaveDefinitionName: item.leaveDefinition.name,
      startDate: item.startDate.toISOString().slice(0, 10),
      endDate: item.endDate.toISOString().slice(0, 10),
      reason: item.reason,
    }))

    const jsonResponse = NextResponse.json({ items: response })
    logApiRequestSuccess(logContext, 200, { count: response.length })
    return withRequestId(jsonResponse, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load approved leaves." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveApprovals", "read", actor => handleGET(request, actor), "approved")
}
