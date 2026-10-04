import { findAccessUser, assignedPermissions } from "./access/server"
import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { requireTenantSession } from "@/lib/tenant-auth"
import { createApiLogContext, logApiRequestError, logApiRequestStart, logApiRequestSuccess, withRequestId } from "@/lib/api-logging"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "./policy"

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { throw new BusinessError(400, "Invalid JSON body.") }
}

export function withBusinessApi(request: Request, handler: (actor: BusinessActor) => Promise<unknown>, successStatus = 200) {
  return withCurrentAccountApi(request, handler, successStatus, false)
}
export async function withCurrentAccountApi(request: Request, handler: (actor: BusinessActor) => Promise<unknown>, successStatus = 200, allowCustomer = true) {
  const log = createApiLogContext(request)
  logApiRequestStart(log, request)
  try {
    const session = await requireTenantSession(request)
    if (session.error) return withRequestId(session.error, log.requestId)
    const { tenantId, sessionUserId } = session.context
    const result = await runWithTenantDbContext(tenantId, async () => {
      const user = sessionUserId ? await findAccessUser(prisma, tenantId, sessionUserId) : null
      const platformSlug = process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
      if (!user || (!hasBusinessAccess(user.role) && !(allowCustomer && user.role === "CUSTOMER")) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === platformSlug) {
        throw new BusinessError(403, "Business workspace access is not permitted.")
      }
      return handler({ tenantId, userId: sessionUserId!, role: user.role, permissions: assignedPermissions(user), crmRecordScope: user.crmRecordScope, managedTeamIds: user.managedTeamIds, requestId: log.requestId })
    })
    logApiRequestSuccess(log, result instanceof NextResponse ? result.status : successStatus)
    if (result instanceof NextResponse) { result.headers.set("Cache-Control", "no-store"); return withRequestId(result, log.requestId) }
    return withRequestId(NextResponse.json(result, { status: successStatus, headers: { "Cache-Control": "no-store" } }), log.requestId)
  } catch (error) {
    const missingMigration = (error as { code?: string })?.code === "P2021"
    const status = error instanceof BusinessError ? error.status : error instanceof ZodError ? 400 : missingMigration ? 503 : 500
    logApiRequestError(log, error, status)
    return withRequestId(NextResponse.json({
      error: error instanceof BusinessError ? error.message : error instanceof ZodError ? "Please check the highlighted fields." : missingMigration ? "Module setup is pending. Contact your administrator." : "Unable to complete this request.",
      ...(error instanceof ZodError ? { details: error.flatten() } : {}),
    }, { status, headers: { "Cache-Control": "no-store" } }), log.requestId)
  }
}
