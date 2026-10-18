import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import { canManageUsers, type Role } from "@/lib/permissions"
import type { BusinessActor } from "@/platform/policy"

export async function servicesDashboardData(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[]) {
  const { tenantId } = actor
  const canReadServices = canManageUsers(actor.role as Role) && moduleEnabled(flags, "services") && permits(actor, "services.read")
  const activeServices = await (
    canReadServices ? tx.service.count({
      where: {
        tenantId,
        status: "ACTIVE",
      },
    }) : Promise.resolve(0)
  )
  return { visible: canReadServices, activeServices }
}
