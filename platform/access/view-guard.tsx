"use client"
import { usePathname } from "next/navigation"
import { useBusinessModules } from "../module-provider"
import { routeRequirement, routeResource } from "./routes"
import type { PermissionAction } from "./catalog"

export function BusinessViewGuard({ children }: { children: React.ReactNode }) {
  const path = usePathname(), { loading, can } = useBusinessModules()
  if (loading) return <p>Loading access...</p>
  const requirement = routeRequirement(path)
  if (!requirement || !can(requirement)) return <div role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Access unavailable</h1><p className="mt-2 text-muted-foreground">Your access role does not include this view. Contact your administrator.</p></div>
  return children
}
export function useCurrentResourceAction(action: PermissionAction) {
  const resource = routeResource(usePathname()), { can } = useBusinessModules()
  return !resource || can(`${resource}.${action}`)
}
