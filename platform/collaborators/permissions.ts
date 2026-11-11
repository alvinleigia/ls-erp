import { accessResources, type Permission } from "@/platform/access/catalog"

// An identity boundary, independent of which reusable profiles are assigned.
export function externalPermissionAllowed(permission: Permission) {
  const resource = permission.split(".")[0] as keyof typeof accessResources
  return !["leaves", "shifts", "customerVerification"].includes(accessResources[resource].module) && !["users", "partnerChoices", "partnerLinks"].includes(resource) && (!(["teams", "teamMembers"].includes(resource)) || permission.endsWith(".read"))
}
