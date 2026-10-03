import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { enterTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromRequest } from "@/lib/tenancy"

export type TenantSessionContext = {
  tenantName: string
  tenantId: string
  role: string | null
  sessionUserId: string | null
}

export const requireTenantSession = async (request: Request) => {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromRequest(request)])

  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  if (!tenant) {
    return { error: NextResponse.json({ error: "Tenant not found." }, { status: 404 }) }
  }

  const sessionTenantId = (session.user as { tenantId?: string | null }).tenantId ?? null
  if (!sessionTenantId || sessionTenantId !== tenant.id) {
    return { error: NextResponse.json({ error: "Invalid tenant context." }, { status: 403 }) }
  }

  enterTenantDbContext(tenant.id)

  return {
    context: {
      tenantId: tenant.id,
      tenantName: tenant.name,
      role: (session.user as { role?: string | null }).role ?? null,
      sessionUserId: (session.user as { id?: string | null }).id ?? null,
    } satisfies TenantSessionContext,
  }
}
