import { WorkspaceOfficeSelector } from "@/platform/companies/workspace-office-selector"
import { ApplicationAccessProvider } from "@/application/access-provider";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { canUseCrm } from "@/lib/permissions";
import { BusinessModuleProvider } from "@/platform/module-provider";
import { TerminologyProvider } from "@/platform/terminology/provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { auth } from "@/auth";
import { resolveTenantFromServerHeaders } from "@/lib/tenancy";
import { prisma, runWithTenantDbContext } from "@/lib/prisma";
import { logoUrl, storageReady } from "@/platform/branding/storage";
import type { TenantBranding } from "@/platform/branding/types";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()]);

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }
  const sessionTenantId = (session.user as { tenantId?: string | null }).tenantId ?? null
  if (!tenant || !sessionTenantId || sessionTenantId !== tenant.id) {
    redirect("/auth/signin?switchTenant=1")
  }
  const currentUser = await runWithTenantDbContext(tenant.id, () => prisma.user.findFirst({
    where: { id: session.user.id, tenantId: tenant.id, status: "ACTIVE" },
    select: { role: true },
  }))
  if (!currentUser) redirect("/auth/signin?sessionExpired=1")
  const businessWorkspace = canUseCrm(currentUser.role) && tenant.slug !== (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")
  const settings = businessWorkspace ? await runWithTenantDbContext(tenant.id, () => prisma.appSetting.findUnique({ where: { tenantId: tenant.id }, select: { branding: true } })) : null
  const branding = (settings?.branding || {}) as TenantBranding
  const sidebarLogo = branding.logo && storageReady() ? logoUrl(branding.logo.sidebar.path) : undefined

  return (
    <BusinessModuleProvider key={`${tenant.id}:${session.user.id}:${currentUser.role}`} active={businessWorkspace}><TerminologyProvider active={businessWorkspace}><ApplicationAccessProvider><SidebarProvider>
      <div className="flex min-h-screen w-full min-w-0">
        <AppSidebar key={sidebarLogo || "default"} brandingLogo={sidebarLogo} brandingName={branding.name || tenant.name} />

        <main className="min-w-0 flex-1 p-6">
          <div className="flex min-w-0 items-center justify-between gap-3"><SidebarTrigger />{businessWorkspace && <WorkspaceOfficeSelector key={`${tenant.id}:${session.user.id}`} tenantId={tenant.id} userId={session.user.id} />}</div>
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </SidebarProvider></ApplicationAccessProvider></TerminologyProvider></BusinessModuleProvider>
  );
}
