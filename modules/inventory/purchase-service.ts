import { percentageMinor,sumRates } from "@/platform/tax/arithmetic"
import { inventoryMutation } from "./transaction"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { inventoryRead, inventoryOfficeLabel } from "./office"
import type { RecordOffice } from "@/types/companies"
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
  officeId: z.string().trim().min(1).max(160).optional(),
})


const toDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`)

type BasePurchase = Prisma.PurchaseOrderGetPayload<{select:typeof purchaseOrderSelect}>
type LabelledPurchase = BasePurchase & {office:RecordOffice;items:(BasePurchase["items"][number] & {product:{id:string;sku:string;name:string}})[]}
export const serializePurchaseOrder = (order: LabelledPurchase) => ({
  id: order.id,
  notes: order.notes,
  officeId: order.officeId, office: order.office,
  orderNumber: order.orderNumber,
  supplier: order.supplier,
  status: order.status,
  orderDate: order.orderDate.toISOString().slice(0, 10),
  expectedDate: order.expectedDate ? order.expectedDate.toISOString().slice(0, 10) : null,
  subtotalCents: order.subtotalCents,
  taxCents: order.taxCents,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  items: order.items.map(item=>({...item,taxPercent:item.taxPercent.toString()})),
})

const purchaseOrderSelect = {
  officeId: true,
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
    },
  },
} satisfies Prisma.PurchaseOrderSelect

async function labelPurchases(tx: Prisma.TransactionClient, tenantId: string, orders: BasePurchase[]): Promise<LabelledPurchase[]> {
  const ids=orders.flatMap(o=>o.items.map(i=>i.id))
  const labels=await tx.$queryRaw<{itemId:string;product:{id:string;sku:string;name:string}}[]>`SELECT * FROM app.inventory_purchase_product_labels(${tenantId},${ids}::text[])`
  const byId=new Map(labels.map(l=>[l.itemId,l.product]))
  return Promise.all(orders.map(async o=>({...o,office:await inventoryOfficeLabel(tx,tenantId,o.officeId,"inventoryPurchases"),items:o.items.map(i=>{
    const product=byId.get(i.id)
    if(!product)throw new BusinessError(409,"Purchase visibility changed. Refresh before continuing.")
    return {...i,product}
  })})))
}
async function readPurchase(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { tenantId,id },select: purchaseOrderSelect })
  return (await labelPurchases(tx,tenantId,[order]))[0]
}
export function getPurchase(actor: BusinessActor,id: string) { return inventoryRead(actor,"inventoryPurchases",tx=>readPurchase(tx,actor.tenantId,id)) }

// Call within the authorized inventory API tenant context.
export async function listPurchases(actor: BusinessActor, query: z.infer<typeof purchaseListSchema>) {
  const { tenantId } = actor
  return inventoryRead(actor,"inventoryPurchases",async tx=>{
  const { page, pageSize, sort, order, q, status, supplierId } = query
  const skip = (page - 1) * pageSize
  const orderBy = sort
    ? { [sort]: order ?? "desc" }
    : { createdAt: "desc" as const }
  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId,
    ...(query.officeId ? { officeId: query.officeId } : {}),
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

  const total = await tx.purchaseOrder.count({ where })
  const items = await tx.purchaseOrder.findMany({where,orderBy,skip,take:pageSize,select:purchaseOrderSelect})
  const labelled = await labelPurchases(tx,tenantId,items)
  return { items: labelled.map(serializePurchaseOrder), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  })
}

export async function createPurchase(actor: BusinessActor, data: CreatePurchaseOrderInput) {
  return inventoryMutation(actor, "inventoryPurchases", "create", { status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    requirePermission(actor,"inventoryProducts.read")
    if (data.status === "RECEIVED") requirePermission(actor, "inventoryProducts.edit")
    const [number] = await tx.$queryRaw<{ value:string }[]>`SELECT app.inventory_next_purchase_number(${tenantId}) value`
    const orderNumber = number.value

    const productIds = [...new Set(data.items.map((item) => item.productId))]
    const products = await tx.inventoryProduct.findMany({
      where: { tenantId, id: { in: productIds } },
      select: {
        id: true,
        taxes: { select: { tax: { select: { percent: true } } } },
      },
    })
    const taxMap = new Map(
      products.map((product) => [
        product.id,
        sumRates(product.taxes.map(item=>item.tax.percent)),
      ])
    )

    const supplier = await tx.supplier.findFirst({
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
      const taxPercent = taxMap.get(item.productId) ?? '0'
      const lineSubtotalCents = quantity * unitCostCents
      const lineTaxCents = percentageMinor(lineSubtotalCents,taxPercent)
      const lineTotalCents = lineSubtotalCents + lineTaxCents
      return {
        ...item,
        quantity,
        unitCostCents,
        taxPercent,
        lineSubtotalCents,
        lineTaxCents,
        lineTotalCents,
        receivedQty: 0,
      }
    })

    const subtotalCents = linePayload.reduce((sum, item) => sum + item.lineSubtotalCents, 0)
    const taxCents = linePayload.reduce((sum, item) => sum + item.lineTaxCents, 0)
    const totalCents = subtotalCents + taxCents
    const initialStatus = data.status ?? "ORDERED"

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
    if (initialStatus === "RECEIVED") await tx.$executeRaw`SELECT app.inventory_post_receipt(${tenantId},${order.id},${actor.requestId ?? null})`
    return readPurchase(tx,tenantId,order.id)
  })
}

export async function updatePurchase(actor: BusinessActor, id: string, data: UpdatePurchaseOrderInput) {
  return inventoryMutation(actor, "inventoryPurchases", "edit", { id, status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    const existing = await tx.purchaseOrder.findUniqueOrThrow({ where: { id, tenantId }, select: purchaseOrderSelect })
    const nextStatus = data.status ?? existing.status
    const shouldReceive = existing.status !== "RECEIVED" && nextStatus === "RECEIVED"
    if (shouldReceive) requirePermission(actor, "inventoryProducts.edit")
    await tx.purchaseOrder.update({
      where: { id, tenantId }, data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.expectedDate !== undefined ? { expectedDate: data.expectedDate ? toDateOnly(data.expectedDate) : null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        ...(shouldReceive ? { receivedAt: new Date() } : {}),
      }
    })
    if (shouldReceive) await tx.$executeRaw`SELECT app.inventory_post_receipt(${tenantId},${id},${actor.requestId ?? null})`
    return readPurchase(tx,tenantId,id)
  })
}
