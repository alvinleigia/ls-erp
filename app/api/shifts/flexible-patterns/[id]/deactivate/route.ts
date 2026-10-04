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

async function handlePOST(
  request: Request,
  context: { params: Promise<{ id: string }> }, actor: BusinessActor) {
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

  const { id } = await context.params
  try {
    const result = await prisma.staffFlexiblePattern.updateMany({
      where: {
        id,
        staffProfile: {
          user: {
            tenantId,
            role: "STAFF",
          },
        },
      },
      data: {
        isActive: false,
      },
    })

    if (!result.count) {
      const response = NextResponse.json({ error: "Recurring pattern not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const response = NextResponse.json({ success: true })
    logApiRequestSuccess(logContext, 200, { patternId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to deactivate recurring pattern." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}


export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "archive", actor => handlePOST(request, context, actor), "flexible-patterns/[id]/deactivate", (await context.params).id)
}
