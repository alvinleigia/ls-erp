"use client"
import { usePathname } from "next/navigation"
import { useBusinessModules } from "../module-provider"
import { useRouteAccess } from "./route-provider"
import type { PermissionAction } from "./catalog"
import type { BusinessModuleKey } from "../modules"
import { useContext } from "react"
import { RecordAccessContext } from "./record-context"

export function BusinessViewGuard({ children, module }: { children: React.ReactNode; module?: BusinessModuleKey }) {
  const { routeRequirement } = useRouteAccess()
  const path = usePathname(), { loading, can, enabled } = useBusinessModules()
  if (loading) return <p>Loading access...</p>
  if (module && !enabled(module)) return <div role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Module unavailable</h1><p className="mt-2 text-muted-foreground">This module is not enabled for your workspace. Contact your administrator.</p></div>
  const requirement = routeRequirement(path)
  if (!requirement || !can(requirement)) return <div role="alert" className="rounded-xl border p-6"><h1 className="text-xl font-semibold">Access unavailable</h1><p className="mt-2 text-muted-foreground">Your access role does not include this view. Contact your administrator.</p></div>
  return children
}
export function useCurrentResourceAction(action: PermissionAction) {
  const { routeResource } = useRouteAccess()
  const record = useContext(RecordAccessContext)
  const path = usePathname()
  const resource = record?.resource ?? routeResource(path), { can } = useBusinessModules()
  return !resource || can(`${resource}.${action}`)
}
