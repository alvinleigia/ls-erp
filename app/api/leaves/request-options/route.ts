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

  try {
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

    const items = await prisma.leaveDefinition.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        leaveGroups: {
          some: {
            leaveGroup: {
              tenantId,
              status: "ACTIVE",
              OR: [
                { assignmentMode: "ALL_STAFF" },
                {
                  assignmentMode: "SELECTED_STAFF",
                  staffAssignments: {
                    some: {
                      staffProfileId: resolvedStaffProfile.id,
                    },
                  },
                },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    })

    const response = NextResponse.json({
      items: items.map((item) => ({
        value: item.id,
        label: `${item.code} - ${item.name}`,
      })),
    })
    logApiRequestSuccess(logContext, 200, { count: items.length })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave options." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "read", actor => handleGET(request, actor), "request-options")
}
