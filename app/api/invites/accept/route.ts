import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromRequest } from "@/lib/tenancy"
import { BusinessError } from "@/platform/policy"
import { acceptInvitation } from "@/platform/invitations/service"
import { createApiLogContext, logApiRequestError, withRequestId } from "@/lib/api-logging"

export async function POST(request: Request) {
  const log = createApiLogContext(request)
  try {
    const body = await request.json().catch(() => { throw new BusinessError(400, "Invalid JSON body.") })
    const tenant = await resolveTenantFromRequest(request)
    if (!tenant) throw new BusinessError(404, "Tenant not found.")
    const result = await runWithTenantDbContext(tenant.id, () => acceptInvitation(prisma, tenant.id, body, log.requestId))
    return withRequestId(NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }), log.requestId)
  } catch (error) {
    if (error instanceof BusinessError) return withRequestId(NextResponse.json({ error: error.message }, { status: error.status }), log.requestId)
    if (error instanceof ZodError) return withRequestId(NextResponse.json({ error: "Invalid invitation input or access configuration.", details: error.flatten() }, { status: 400 }), log.requestId)
    logApiRequestError(log, error, 500)
    return withRequestId(NextResponse.json({ error: "Unable to accept invitation." }, { status: 500 }), log.requestId)
  }
}
