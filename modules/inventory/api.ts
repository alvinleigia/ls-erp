import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export type InventoryResource = "inventoryProducts" | "inventoryCategories" | "inventorySuppliers" | "inventoryPurchases"

const findRecord = (resource: InventoryResource, tenantId: string, id: string) => {
  const args = { where: { tenantId, id } }
  switch (resource) {
    case "inventoryProducts": return prisma.inventoryProduct.findFirst(args)
    case "inventoryCategories": return prisma.inventoryCategory.findFirst(args)
    case "inventorySuppliers": return prisma.supplier.findFirst(args)
    case "inventoryPurchases": return prisma.purchaseOrder.findFirst(args)
  }
}

// Retain legacy admin/manager authority; assigned roles can only narrow it.
export function withInventoryApi(request: Request, resource: InventoryResource, action: PermissionAction, handler: (actor: BusinessActor) => Promise<NextResponse>, id?: string) {
  return withBusinessApi(request, async actor => {
    if (!canManageUsers(actor.role as Role)) throw new BusinessError(403, "Inventory requires administrator or manager access.")
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
    const response = await handler(actor)
    if (response.ok && action !== "read") {
      const result = await response.clone().json()
      const entityId = id ?? result.item?.id
      const after = entityId ? await findRecord(resource, actor.tenantId, entityId) : null
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: `inventory.${resource}.${action}`, entityType: resource, entityId,
        ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}),
        ...(after ? { after: JSON.parse(JSON.stringify(after)) } : {}),
      })
    }
    return response
  })
}
