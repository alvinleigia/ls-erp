import type { Resource } from "../access/catalog"
import type { FieldScope } from "./validation"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { BusinessModuleKey } from "../modules"
import type { TermText } from "../terminology/message"

// Context stays module-owned. The existing salesTeamId storage/API is preserved.
export type FieldContext = {
  teamScoped: boolean
  validate(tx: Prisma.TransactionClient, actor: BusinessActor, salesTeamId: string | null, mode: "form" | "create" | "edit"): Promise<void>
}

// Resource descriptors are registered by modules, never supplied by requests.
export type FieldResource = {
  key: string; permissionResource: Resource; label: string; module: BusinessModuleKey; table: string; scopes: readonly FieldScope[]
  context: FieldContext
  scopeLabels: Partial<Record<FieldScope, TermText>>
  recordTeams?(tx: Prisma.TransactionClient, actor: BusinessActor, ids: string[]): Promise<Map<string, string | null>>
}

export type FieldScopeOption = { scope: FieldScope; label: TermText; teamScoped: boolean; module: BusinessModuleKey }
export function fieldScopeOptions(resources: readonly FieldResource[]): FieldScopeOption[] {
  const options = new Map<FieldScope, FieldScopeOption>()
  for (const resource of resources) for (const scope of resource.scopes) {
    options.set(scope, { scope, label: resource.scopeLabels[scope]!, teamScoped: resource.context.teamScoped, module: resource.module })
  }
  return [...options.values()]
}

export function registerFieldResources(resources: readonly FieldResource[]): readonly FieldResource[] {
  const keys = new Set<string>(), scopes = new Map<FieldScope, FieldResource>()
  for (const resource of resources) {
    if (keys.has(resource.key) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(resource.table) || !resource.scopes.length) throw new Error("Invalid custom-field resource registration.")
    keys.add(resource.key)
    for (const scope of resource.scopes) {
      if (!resource.scopeLabels[scope]) throw new Error("Missing custom-field scope label registration.")
      const owner = scopes.get(scope)
      if (owner && (owner.module !== resource.module || owner.context !== resource.context)) throw new Error("Shared custom-field scopes require the same module and context policy.")
      if (owner && JSON.stringify(owner.scopeLabels[scope]) !== JSON.stringify(resource.scopeLabels[scope])) throw new Error("Shared custom-field scopes require the same label.")
      scopes.set(scope, resource)
    }
  }
  return resources
}
