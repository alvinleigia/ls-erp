import type { Prisma } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { lockTenantOperations } from "@/platform/transactions/tenant-operation"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export async function stockAuthority(tx: Prisma.TransactionClient, actor: BusinessActor, tenantId: string) {
  if (actor.tenantId !== tenantId) throw new BusinessError(403,"Inventory access is required for stock changes.")
  requirePermission(actor,"inventoryProducts.edit")
  await lockTenantOperations(tx,tenantId)
  await authorizeBusinessOperation(tx,actor,"inventoryProducts.edit",["inventory"])
}
