import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { CoreLayout } from "@/platform/core/layout"
import { getPlatformConsoleAccessFromSession } from "@/lib/platform-console"
import { resolveTenantFromServerHeaders } from "@/lib/tenancy"

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [session, tenant] = await Promise.all([auth(), resolveTenantFromServerHeaders()])

  if (!session?.user) {
    redirect("/auth/signin")
  }

  if (tenant?.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) {
    const platformAccess = await getPlatformConsoleAccessFromSession(session)
    if (platformAccess) {
      return <>{children}</>
    }
  }

  return <CoreLayout>{children}</CoreLayout>
}
