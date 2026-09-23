import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { requireTenantSession } from "@/lib/tenant-auth"
import { createApiLogContext, logApiRequestError, logApiRequestStart, logApiRequestSuccess, withRequestId } from "@/lib/api-logging"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "./policy"

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { throw new BusinessError(400, "Invalid JSON body.") }
}

export async function withBusinessApi(request: Request, handler: (actor: BusinessActor) => Promise<unknown>, successStatus = 200) {
  const log = createApiLogContext(request)
  logApiRequestStart(log, request)
  try {
    const session = await requireTenantSession(request)
    if (session.error) return withRequestId(session.error, log.requestId)
    const { tenantId, sessionUserId } = session.context
    const result = await runWithTenantDbContext(tenantId, async () => {
      const user = sessionUserId ? await prisma.user.findFirst({
        where: { id: sessionUserId, tenantId, status: "ACTIVE" },
        select: { role: true, tenant: { select: { slug: true, status: true } } },
      }) : null
      const platformSlug = process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
      if (!user || !hasBusinessAccess(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === platformSlug) {
        throw new BusinessError(403, "Business workspace access is not permitted.")
      }
      return handler({ tenantId, userId: sessionUserId!, role: user.role, requestId: log.requestId })
    })
    logApiRequestSuccess(log, successStatus)
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
