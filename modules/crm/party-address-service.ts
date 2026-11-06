import { createPartyAddressService } from "@/platform/addresses/service"
import { contactScope, accountScope } from "./policy"
import type { CrmServiceContext } from "./service-context"
import type { PermissionRun } from "@/platform/access/server"

export function createCrmPartyAddressService(context: CrmServiceContext & { runLocked: PermissionRun }) {
  return createPartyAddressService({ ...context, owner: async (tx, actor, owner, action, lock) => {
    if (owner.kind === "PERSON") {
      if (lock) await tx.$queryRaw`SELECT id FROM "CrmContact" WHERE "tenantId"=${actor.tenantId} AND id=${owner.id} FOR UPDATE`
      return tx.crmContact.findFirst({ where: { ...contactScope(actor, action), id: owner.id }, select: { id: true, archived: true } })
    }
    if (lock) await tx.$queryRaw`SELECT id FROM "CrmAccount" WHERE "tenantId"=${actor.tenantId} AND id=${owner.id} FOR UPDATE`
    return tx.crmAccount.findFirst({ where: { ...accountScope(actor, action), id: owner.id }, select: { id: true, archived: true } })
  } })
}
