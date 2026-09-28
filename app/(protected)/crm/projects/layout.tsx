import Link from "next/link"
import { auth } from "@/auth"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()])
  if (!session?.user || !tenant || session.user.tenantId !== tenant.id) return null
  const enabled = await runWithTenantDbContext(tenant.id, () => prisma.tenantModule.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "realEstate" } } }))
  if (!enabled?.enabled) return <div className="space-y-3"><h1 className="text-2xl font-semibold">Real Estate is not enabled</h1><p>Ask your business administrator to enable Real Estate in <Link className="underline" href="/settings/modules">Business modules</Link>.</p></div>
  return children
}
