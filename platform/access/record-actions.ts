import { BusinessError, type BusinessActor } from "../policy"
import { accessResources, type Permission, type PermissionAction, type Resource } from "./catalog"
import { permits } from "./policy"
import { recordLimits } from "./rules"
import type { Prisma } from "@prisma/client"
import { sharingAllows } from "./sharing-scope"

export type RecordAccess = { resource: Resource; id: string; permissions: Partial<Record<Permission, boolean>> }
// Call after loading the record through its Read predicate. The response describes
// this record's actions for the UI; every mutation still checks its own predicate.
export async function recordActionAccess(actor: BusinessActor, resource: Resource, id: string, tx: Prisma.TransactionClient,
  probe: (action: PermissionAction) => Promise<unknown>): Promise<RecordAccess> {
  const entries = await Promise.all(accessResources[resource].actions.map(async action => {
    const permission = `${resource}.${action}` as Permission
    if (!permits(actor, permission)) return [permission, false] as const
    const limits = recordLimits(actor, resource, action)
    const definition = accessResources[resource]
    const newRecord = action === "create" && !("createOnRecord" in definition && definition.createOnRecord)
    try { return [permission, !limits.includes("NONE") && (newRecord || await sharingAllows(tx, actor, resource, id, action)) && (newRecord || !limits.length || !!await probe(action))] as const }
    catch (error) { if (error instanceof BusinessError && error.status === 404) return [permission, false] as const; throw error }
  }))
  return { resource, id, permissions: Object.fromEntries(entries) }
}
