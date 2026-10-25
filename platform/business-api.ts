import { findAccessUser, accessContext } from "./access/server"
import { runWithDatabaseActor } from "@/lib/database-actor"
import { runWithOfficeRequest } from "@/lib/database-office"
import { officeExpectation, officeBoundaryError } from "./companies/record-office"
import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { requireTenantSession } from "@/lib/tenant-auth"
import { createApiLogContext, logApiRequestError, logApiRequestStart, logApiRequestSuccess, withRequestId } from "@/lib/api-logging"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "./policy"
import type { ErrorPresenter } from "./terminology/error-presentation"

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { throw new BusinessError(400, "Invalid JSON body.") }
}

export function withBusinessApi(request: Request, handler: (actor: BusinessActor) => Promise<unknown>, successStatus = 200, presentError?: ErrorPresenter) {
  return withCurrentAccountApi(request, handler, successStatus, false, presentError)
}
export async function withCurrentAccountApi(request: Request, handler: (actor: BusinessActor) => Promise<unknown>, successStatus = 200, allowCustomer = true, presentError?: ErrorPresenter) {
  const log = createApiLogContext(request)
  logApiRequestStart(log, request)
  let actor: BusinessActor | undefined
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
      actor = { tenantId, userId: sessionUserId!, ...accessContext(user), requestId: log.requestId }
      return runWithDatabaseActor(actor.userId, () => runWithOfficeRequest(officeExpectation(request), () => handler(actor!)))
    })
    logApiRequestSuccess(log, result instanceof NextResponse ? result.status : successStatus)
    if (result instanceof NextResponse) { result.headers.set("Cache-Control", "no-store"); return withRequestId(result, log.requestId) }
    return withRequestId(NextResponse.json(result, { status: successStatus, headers: { "Cache-Control": "no-store" } }), log.requestId)
  } catch (caught) {
    const error = officeBoundaryError(caught) ?? caught
    const missingMigration = (error as { code?: string })?.code === "P2021"
    const status = error instanceof BusinessError ? error.status : error instanceof ZodError ? 400 : missingMigration ? 503 : 500
    logApiRequestError(log, error, status)
    const presented = actor && presentError ? await runWithTenantDbContext(actor.tenantId, () => presentError(error, actor!)).catch(() => undefined) : undefined
    return withRequestId(NextResponse.json({
      error: error instanceof BusinessError ? error.message : error instanceof ZodError ? "Please check the highlighted fields." : missingMigration ? "Module setup is pending. Contact your administrator." : "Unable to complete this request.",
      ...(error instanceof ZodError ? { details: error.flatten() } : {}),
      ...presented,
    }, { status, headers: { "Cache-Control": "no-store" } }), log.requestId)
  }
}
