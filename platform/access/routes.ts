import type { Resource, Requirement } from "./catalog"

export type RouteAccessPolicy = {
  resources: readonly (readonly [string, Resource])[]
  exactResources?: Readonly<Record<string, Resource>>
  exactRequirements?: Readonly<Record<string, Requirement>>
  prefixRequirements?: readonly (readonly [string, Requirement])[]
  protectedLinkPrefixes?: readonly string[]
}
const matches = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

// Route metadata is composed by the application. The platform only resolves it.
// More specific resource prefixes must precede their parent, as with navigation.
export function createRouteAccess(policy: RouteAccessPolicy) {
  function routeResource(path: string): Resource | undefined {
    return policy.exactResources?.[path] ?? policy.resources.find(([base]) => matches(path, base))?.[1]
  }
  function routeRequirement(path: string): Requirement | undefined {
    const explicit = policy.exactRequirements?.[path] ?? policy.prefixRequirements?.find(([base]) => matches(path, base))?.[1]
    if (explicit) return explicit
    const resource = routeResource(path)
    return resource ? `${resource}.${path.endsWith("/new") ? "create" : "read"}` : undefined
  }
  function linkRequirement(path: string) {
    return policy.protectedLinkPrefixes?.some(base => matches(path, base)) ? routeRequirement(path) : undefined
  }
  return { routeResource, routeRequirement, linkRequirement }
}
export type RouteAccess = ReturnType<typeof createRouteAccess>
