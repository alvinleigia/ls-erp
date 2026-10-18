import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { purchaseOrderStatusSchema, type CreatePurchaseOrderInput, type UpdatePurchaseOrderInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"

export const purchaseListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "orderDate", "orderNumber", "status"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: purchaseOrderStatusSchema.optional(),
  supplierId: z.string().trim().optional(),
})


const toDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`)

export const serializePurchaseOrder = (order: Prisma.PurchaseOrderGetPayload<{ select: typeof purchaseOrderSelect }>) => ({
  id: order.id,
  notes: order.notes,
  orderNumber: order.orderNumber,
  supplier: order.supplier,
  status: order.status,
  orderDate: order.orderDate.toISOString().slice(0, 10),
  expectedDate: order.expectedDate ? order.expectedDate.toISOString().slice(0, 10) : null,
  subtotalCents: order.subtotalCents,
  taxCents: order.taxCents,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  items: order.items,
})

const purchaseOrderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  orderDate: true,
  expectedDate: true,
  subtotalCents: true,
  taxCents: true,
  totalCents: true,
  createdAt: true,
  notes: true,
  supplier: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      receivedQty: true,
      unitCostCents: true,
      taxPercent: true,
      lineSubtotalCents: true,
      lineTaxCents: true,
      lineTotalCents: true,
      productId: true,
      product: { select: { id: true, sku: true, name: true } },
    },
  },
} satisfies Prisma.PurchaseOrderSelect

// Receipt quantities are cumulative. Never clear them when a status is reopened.
async function receivePurchaseItems(tx: Prisma.TransactionClient, tenantId: string, order: {
  id: string; orderNumber: string;
  items: { id: string; productId: string; quantity: number; receivedQty: number; unitCostCents: number }[];
}, createdReceived = false) {
  const movements: Prisma.InventoryStockMovementCreateManyInput[] = []
  for (const item of [...order.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const quantityDelta = createdReceived ? item.quantity : item.quantity - item.receivedQty
    if (quantityDelta <= 0) continue
    // Creation can write the received quantity with the new line; updates amend it.
    if (!createdReceived) await tx.purchaseOrderItem.update({ where: { id: item.id, order: { tenantId } }, data: { receivedQty: item.quantity } })
    await tx.inventoryProduct.update({ where: { id: item.productId, tenantId }, data: {
      onHandQty: { increment: quantityDelta }, costPriceCents: item.unitCostCents,
    } })
    movements.push({
      tenantId, productId: item.productId, orderItemId: item.id, type: "PURCHASE_RECEIPT",
      quantityDelta, unitCostCents: item.unitCostCents, note: `Purchase receipt ${order.orderNumber}`,
    })
  }
  if (movements.length) await tx.inventoryStockMovement.createMany({ data: movements })
}

// Call within the authorized inventory API tenant context.
export async function listPurchases(tenantId: string, query: z.infer<typeof purchaseListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, sort, order, q, status, supplierId } = query
  const skip = (page - 1) * pageSize
  const orderBy = sort
    ? { [sort]: order ?? "desc" }
    : { createdAt: "desc" as const }
  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId,
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" } },
            { supplier: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: purchaseOrderSelect,
    }),
  ])

  return { items: items.map(serializePurchaseOrder), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function createPurchase(actor: BusinessActor, data: CreatePurchaseOrderInput) {
  const { tenantId } = actor
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (data.status === "RECEIVED") requirePermission(actor, "inventoryProducts.edit")
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  const runningCount = await prisma.purchaseOrder.count({
    where: {
      tenantId,
      createdAt: { gte: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) },
    },
  })
  const orderNumber = `PO-${today}-${String(runningCount + 1).padStart(4, "0")}`

  const productIds = [...new Set(data.items.map((item) => item.productId))]
  const products = await prisma.inventoryProduct.findMany({
    where: { tenantId, id: { in: productIds } },
    select: {
      id: true,
      taxes: { select: { tax: { select: { percent: true } } } },
    },
  })
  const taxMap = new Map(
    products.map((product) => [
      product.id,
      product.taxes.reduce((sum, item) => sum + Math.max(0, item.tax.percent), 0),
    ])
  )

  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, tenantId },
    select: { id: true },
  })
  if (!supplier) {
    throw new BusinessError(404, "Supplier not found.")
  }
  if (products.length !== productIds.length) {
    throw new BusinessError(400, "One or more products do not belong to this tenant.")
  }

  const linePayload = data.items.map((item) => {
    const quantity = Math.max(1, item.quantity)
    const unitCostCents = Math.max(0, item.unitCostCents)
    const taxPercent = taxMap.get(item.productId) ?? 0
    const lineSubtotalCents = quantity * unitCostCents
    const lineTaxCents = Math.round((lineSubtotalCents * taxPercent) / 100)
    const lineTotalCents = lineSubtotalCents + lineTaxCents
    return {
      ...item,
      quantity,
      unitCostCents,
      taxPercent,
      lineSubtotalCents,
      lineTaxCents,
      lineTotalCents,
      receivedQty: data.status === "RECEIVED" ? quantity : 0,
    }
  })

  const subtotalCents = linePayload.reduce((sum, item) => sum + item.lineSubtotalCents, 0)
  const taxCents = linePayload.reduce((sum, item) => sum + item.lineTaxCents, 0)
  const totalCents = subtotalCents + taxCents
  const initialStatus = data.status ?? "ORDERED"

  return prisma.$transaction(async tx => {
    const order = await tx.purchaseOrder.create({
      data: {
        tenantId,
        orderNumber,
        supplierId: data.supplierId,
        status: initialStatus,
        orderDate: toDateOnly(data.orderDate),
        expectedDate: data.expectedDate ? toDateOnly(data.expectedDate) : null,
        notes: data.notes?.trim() || undefined,
        subtotalCents,
        taxCents,
        totalCents,
        receivedAt: initialStatus === "RECEIVED" ? new Date() : null,
        items: {
          create: linePayload.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            receivedQty: item.receivedQty,
            unitCostCents: item.unitCostCents,
            taxPercent: item.taxPercent,
            lineSubtotalCents: item.lineSubtotalCents,
            lineTaxCents: item.lineTaxCents,
            lineTotalCents: item.lineTotalCents,
          })),
        },
      },
      select: purchaseOrderSelect,
    })
    if (initialStatus === "RECEIVED") await receivePurchaseItems(tx, tenantId, order, true)
    return order
  })
}

export async function updatePurchase(actor: BusinessActor, id: string, data: UpdatePurchaseOrderInput) {
  const { tenantId } = actor
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  return prisma.$transaction(async tx => {
    // Serialize receipt transitions on this purchase, including concurrent requests.
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM "PurchaseOrder" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`)
    if (!locked.length) throw new BusinessError(404, "Purchase order not found.")
    const existing = await tx.purchaseOrder.findUniqueOrThrow({ where: { id, tenantId }, select: purchaseOrderSelect })
    const nextStatus = data.status ?? existing.status
    const shouldReceive = existing.status !== "RECEIVED" && nextStatus === "RECEIVED"
    if (shouldReceive) requirePermission(actor, "inventoryProducts.edit")
    await tx.purchaseOrder.update({ where: { id, tenantId }, data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.expectedDate !== undefined ? { expectedDate: data.expectedDate ? toDateOnly(data.expectedDate) : null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      ...(shouldReceive ? { receivedAt: new Date() } : {}),
    } })
    if (shouldReceive) await receivePurchaseItems(tx, tenantId, existing)
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id, tenantId }, select: purchaseOrderSelect })
  })
}
