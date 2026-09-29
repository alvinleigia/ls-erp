import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { canUseCrm } from "@/lib/permissions";
import { BusinessModuleProvider } from "@/platform/module-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { auth } from "@/auth";
import { resolveTenantFromServerHeaders } from "@/lib/tenancy";

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

  return (
    <BusinessModuleProvider key={`${tenant.id}:${session.user.id}:${session.user.role}`} active={canUseCrm(session.user.role) && tenant.slug !== (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")}><SidebarProvider>
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
