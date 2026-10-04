import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"
import { findAccessUser } from "../access/server"
import { CoreViewGuard } from "./view-guard"

export async function CoreLayout({ children }: { children: React.ReactNode }) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()])
  if (!session?.user?.id || !tenant || session.user.tenantId !== tenant.id) redirect("/auth/signin")
  const userId = session.user.id
  const user = await runWithTenantDbContext(tenant.id, () => findAccessUser(prisma, tenant.id, userId))
  if (!user || user.tenant.status !== "ACTIVE") redirect("/auth/signin")
  if (user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) redirect("/settings/tenants")
  return <CoreViewGuard role={user.role} userId={userId}>{children}</CoreViewGuard>
}
