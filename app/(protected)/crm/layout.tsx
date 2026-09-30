import { BusinessViewGuard } from "@/platform/access/view-guard"
import { ApplicationCrmProvider } from "@/application/crm/provider"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"
import { canUseCrm } from "@/lib/permissions"
import { WorkReminders } from "@/modules/crm/components/work-reminders"

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
  // Keep CRM tables/boards from setting the surrounding app shell's intrinsic width.
  return <ApplicationCrmProvider><div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 [contain:inline-size]"><BusinessViewGuard><WorkReminders />{children}</BusinessViewGuard></div></ApplicationCrmProvider>
}
