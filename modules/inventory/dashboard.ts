import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"

export async function inventoryDashboardData(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[]) {
  const { tenantId } = actor
  const canReadStock = moduleEnabled(flags, "inventory") && permits(actor, "inventoryProducts.read")
  const lowStockProducts = await (
    canReadStock ? tx.inventoryProduct.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        onHandQty: { lte: tx.inventoryProduct.fields.reorderPoint },
      },
      orderBy: [{ onHandQty: "asc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        sku: true,
        name: true,
        onHandQty: true,
        reorderPoint: true,
        reorderQty: true,
        category: { select: { name: true } },
      },
    }) : Promise.resolve([])
  )
  return { visible: canReadStock, lowStockProducts }
}
