import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { canUseCrm } from "@/lib/permissions";
import { BusinessModuleProvider } from "@/platform/module-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { auth } from "@/auth";
import { resolveTenantFromServerHeaders } from "@/lib/tenancy";
import { prisma, runWithTenantDbContext } from "@/lib/prisma";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()]);

  if (!session?.user) {
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

  return (
    <BusinessModuleProvider key={`${tenant.id}:${session.user.id}:${currentUser.role}`} active={canUseCrm(currentUser.role) && tenant.slug !== (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")}><SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />

        <main className="flex-1 p-6">
          <SidebarTrigger />
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </SidebarProvider></BusinessModuleProvider>
  );
}
