"use client"
import { usePathname } from "next/navigation"
import { BusinessViewGuard } from "../access/view-guard"

export function CoreViewGuard({ children, role, userId }: { children: React.ReactNode; role: string; userId: string }) {
  const path = usePathname()
  if (path === `/users/${userId}`) return children
  const administrative = ["/settings/roles", "/settings/modules", "/settings/terminology", "/settings/seeds", "/settings/tenants", "/settings/organizations", "/users/invites"].some(base => path === base || path.startsWith(`${base}/`))
  if (role === "CUSTOMER" || (administrative && role !== "ADMIN")) return <div role="alert"><h1 className="text-xl font-semibold">Access unavailable</h1><p>This view requires management access.</p></div>
  if (administrative) return children
  return <BusinessViewGuard><div className="min-w-0 [contain:inline-size]">{children}</div></BusinessViewGuard>
}
