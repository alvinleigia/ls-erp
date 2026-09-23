import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"
import { canUseCrm } from "@/lib/permissions"

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()])
  if (!session?.user || !tenant || session.user.tenantId !== tenant.id) redirect("/auth/signin")
  if (tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) redirect("/settings/tenants")
  const access = await runWithTenantDbContext(tenant.id, async () => {
    const user = await prisma.user.findFirst({ where: { id: session.user.id, tenantId: tenant.id, status: "ACTIVE" }, select: { role: true } })
    if (!user || !canUseCrm(user.role)) return null
    const enabledModule = await prisma.tenantModule.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "crm" } } })
    return { enabled: !!enabledModule?.enabled, role: user.role }
  })
  if (!access) redirect("/dashboard")
  if (!access.enabled) return <div className="space-y-3"><h1 className="text-2xl font-semibold">CRM is not enabled</h1><p>Ask your business administrator to enable CRM for this workspace.</p>{access.role === "ADMIN" && <Link className="underline" href="/settings/modules">Manage business modules</Link>}</div>
  return <div className="space-y-6"><nav aria-label="CRM" className="flex flex-wrap gap-5 border-b pb-3 text-sm"><Link className="hover:underline" href="/crm/enquiries">Enquiries</Link><Link className="hover:underline" href="/crm/contacts">Contacts</Link><Link className="hover:underline" href="/crm/accounts">Business accounts</Link><Link className="hover:underline" href="/crm/tasks">Follow-ups</Link></nav>{children}</div>
}
