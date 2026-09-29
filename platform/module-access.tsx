import Link from "next/link"
import { auth } from "@/auth"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"
import { businessModules, moduleEnabled, type BusinessModuleKey } from "./modules"

// Nested beneath the authenticated CRM layout; APIs independently enforce access.
export async function ModuleAccess({ module, children }: { module: BusinessModuleKey; children: React.ReactNode }) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()])
  if (!tenant || session?.user?.tenantId !== tenant.id) return null
  const flags = await runWithTenantDbContext(tenant.id, () => prisma.tenantModule.findMany({ where: { tenantId: tenant.id } }))
  if (!moduleEnabled(flags, module)) return <div className="space-y-3"><h1 className="text-2xl font-semibold">{businessModules[module].name} is not enabled</h1><p>Ask your business administrator to enable this module.</p><Link className="underline" href="/settings/modules">Business modules</Link></div>
  return children
}
