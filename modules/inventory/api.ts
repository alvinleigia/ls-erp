import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

import type { InventoryResource } from "./transaction"

const findRecord = (resource: InventoryResource, tenantId: string, id: string) => {
  const args = { where: { tenantId, id } }
  switch (resource) {
    case "inventoryProducts": return prisma.inventoryProduct.findFirst(args)
    case "inventoryCategories": return prisma.inventoryCategory.findFirst(args)
    case "inventorySuppliers": return prisma.supplier.findFirst(args)
    case "inventoryPurchases": return prisma.purchaseOrder.findFirst(args)
  }
}

// Activation and composed action permissions apply to all business accounts.
export function withInventoryApi(request: Request, resource: InventoryResource, action: PermissionAction, handler: (actor: BusinessActor) => Promise<NextResponse>, id?: string) {
  return withBusinessApi(request, async actor => {
    await requireBusinessModule(prisma, actor.tenantId, "inventory")
    requirePermission(actor, `${resource}.${action}`)
    const before = id ? await findRecord(resource, actor.tenantId, id) : null
    if (id && !before) throw new BusinessError(404, "Inventory record not found.")
    if (action === "create" || action === "edit") {
      const input = await readJson(request.clone()) as Record<string, unknown> | null
      if (input && resource !== "inventoryPurchases" && input.status !== undefined && input.status !== (before?.status ?? "ACTIVE")) requirePermission(actor, `${resource}.archive`)
      // Receiving purchases changes stock even if the catalog editor is hidden.
      if (resource === "inventoryPurchases" && input?.status === "RECEIVED" && before?.status !== "RECEIVED") requirePermission(actor, "inventoryProducts.edit")
    }
    return handler(actor)
  })
}
