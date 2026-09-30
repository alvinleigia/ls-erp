import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { requirePlatformConsoleAccess } from "@/lib/platform-console"
import { prisma, runWithRlsBypassDbContext } from "@/lib/prisma"
import { createApiLogContext, logApiRequestError, logApiRequestStart, logApiRequestSuccess, withRequestId } from "@/lib/api-logging"
import { getTenantModules, updateTenantModuleAllowance } from "@/platform/module-service"
import { BusinessError } from "@/platform/policy"
import { readJson } from "@/platform/business-api"

export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }

async function handle(request: Request, context: Context, update: boolean) {
  const log = createApiLogContext(request)
  logApiRequestStart(log, request)
  const authorized = await requirePlatformConsoleAccess(request, { requireSuperAdmin: true })
  if (authorized.error) return withRequestId(authorized.error, log.requestId)
  if (!authorized.context.sessionUserId) return withRequestId(NextResponse.json({ error: "Unauthorized." }, { status: 401 }), log.requestId)
  try {
    const { id } = await context.params
    const actor = { tenantId: authorized.context.tenantId, userId: authorized.context.sessionUserId, requestId: log.requestId }
    const input = update ? await readJson(request) : undefined
    const result = await runWithRlsBypassDbContext(() => update ? updateTenantModuleAllowance(prisma, actor, id, input) : getTenantModules(prisma, actor, id))
    logApiRequestSuccess(log, 200, { tenantId: id })
    return withRequestId(NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }), log.requestId)
  } catch (error) {
    const status = error instanceof BusinessError ? error.status : error instanceof ZodError ? 400 : 500
    if (status === 500) logApiRequestError(log, error, status)
    return withRequestId(NextResponse.json({ error: error instanceof BusinessError ? error.message : status === 400 ? "Invalid module settings." : "Unable to load or update module allowances." }, { status }), log.requestId)
  }
}

export const GET = (request: Request, context: Context) => handle(request, context, false)
export const PATCH = (request: Request, context: Context) => handle(request, context, true)
