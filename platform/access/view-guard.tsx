"use client"
import { usePathname } from "next/navigation"
import { useBusinessModules } from "../module-provider"
import { routeRequirement, routeResource } from "./routes"
import type { PermissionAction } from "./catalog"
import type { BusinessModuleKey } from "../modules"

export function BusinessViewGuard({ children, module, role }: { children: React.ReactNode; module?: BusinessModuleKey; role?: string }) {
  const path = usePathname(), { loading, can, enabled } = useBusinessModules()
  if (loading) return <p>Loading access...</p>
  if (module && !enabled(module)) return <div role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Module unavailable</h1><p className="mt-2 text-muted-foreground">This module is not enabled for your workspace. Contact your administrator.</p></div>
  const requirement = routeRequirement(path)
  if ((module === "leaves" && role === "STAFF" && routeResource(path) !== "leaveRequests") || !requirement || !can(requirement)) return <div role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Access unavailable</h1><p className="mt-2 text-muted-foreground">Your access role does not include this view. Contact your administrator.</p></div>
  return children
}
export function useCurrentResourceAction(action: PermissionAction) {
  const resource = routeResource(usePathname()), { can } = useBusinessModules()
  return !resource || can(`${resource}.${action}`)
}
