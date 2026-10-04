import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { canManageUsers } from "@/lib/permissions"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"
import { moduleEnabled } from "@/platform/modules"
import { BusinessViewGuard } from "@/platform/access/view-guard"

export default async function ServicesLayout({ children }: { children: React.ReactNode }) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()])
  if (!session?.user || !tenant || session.user.tenantId !== tenant.id) redirect("/auth/signin")
  if (tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) redirect("/settings/tenants")
  const access = await runWithTenantDbContext(tenant.id, async () => {
    const user = await prisma.user.findFirst({ where: { id: session.user.id, tenantId: tenant.id, status: "ACTIVE" }, select: { role: true } })
    if (!user || !canManageUsers(user.role)) return null
    const flags = await prisma.tenantModule.findMany({ where: { tenantId: tenant.id } })
    return { role: user.role, enabled: moduleEnabled(flags, "services") }
  })
  if (!access) redirect("/dashboard")
  if (!access.enabled) return <div className="space-y-3"><h1 className="text-2xl font-semibold">Services is not enabled</h1><p>Ask your administrator to enable Services for this workspace.</p>{access.role === "ADMIN" && <Link className="underline" href="/settings/modules">Manage business modules</Link>}</div>
  return <BusinessViewGuard module="services"><div className="min-w-0 [contain:inline-size]">{children}</div></BusinessViewGuard>
}
