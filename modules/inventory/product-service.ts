import { inventoryMutation } from "./transaction"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { inventoryRead, stockOffice, inventoryOfficeLabel } from "./office"
import type { RecordOffice } from "@/types/companies"
import { inventoryProductStatusSchema, type CreateInventoryProductInput, type UpdateInventoryProductInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export const productListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      "createdAt",
      "sku",
      "name",
      "status",
      "mrpCents",
      "costPriceCents",
      "onHandQty",
      "category",
    ])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: inventoryProductStatusSchema.optional(),
  categoryId: z.string().trim().optional(),
  officeId: z.string().trim().min(1).max(160).optional(),
})


const productSelect = (officeId: string) => ({
  officeStocks: { where: { officeId }, select: { onHandQty: true, costPriceCents: true, reorderPoint: true, reorderQty: true, version: true } },
  id: true,
  sku: true,
  name: true,
  description: true,
  unit: true,
  status: true,
  mrpCents: true,
  isPhysical: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  taxes: { select: { taxId: true } },
  suppliers: {
    orderBy: [{ isPreferred: "desc" }, { supplier: { name: "asc" } }],
    select: {
      supplierId: true,
      supplierSku: true,
      supplierCostCents: true,
      minOrderQty: true,
      leadTimeDays: true,
      isPreferred: true,
      supplier: { select: { name: true } },
    },
  },
} satisfies Prisma.InventoryProductSelect)

const serializeProduct = (item: Prisma.InventoryProductGetPayload<{ select: ReturnType<typeof productSelect> }>, office: RecordOffice) => ({
  office, officeId: office.id, stockVersion: item.officeStocks[0]?.version ?? 0,
  id: item.id,
  sku: item.sku,
  name: item.name,
  description: item.description,
  unit: item.unit,
  status: item.status,
  costPriceCents: item.officeStocks[0]?.costPriceCents ?? 0,
  mrpCents: item.mrpCents,
  reorderPoint: item.officeStocks[0]?.reorderPoint ?? 0,
  reorderQty: item.officeStocks[0]?.reorderQty ?? 0,
  onHandQty: item.officeStocks[0]?.onHandQty ?? 0,
  isPhysical: item.isPhysical,
  createdAt: item.createdAt.toISOString(),
  category: item.category,
  taxIds: item.taxes.map((tax) => tax.taxId),
  supplierLinks: item.suppliers.map((link) => ({
    supplierId: link.supplierId,
    supplierName: link.supplier.name,
    supplierSku: link.supplierSku,
    supplierCostCents: link.supplierCostCents,
    minOrderQty: link.minOrderQty,
    leadTimeDays: link.leadTimeDays,
    isPreferred: link.isPreferred,
  })),
})

async function validateProductRelations(tx: Prisma.TransactionClient, tenantId: string, data: UpdateInventoryProductInput) {
  if (data.supplierLinks?.length) {
    const preferredCount = data.supplierLinks.filter((link) => link.isPreferred).length
    if (preferredCount > 1) {
      throw new BusinessError(400, "Only one preferred supplier can be selected.")
    }
  }

  if (data.categoryId) {
    const category = await tx.inventoryCategory.findFirst({
      where: { id: data.categoryId, tenantId },
      select: { id: true },
    })
    if (!category) {
      throw new BusinessError(404, "Category not found.")
    }
  }
  if (data.supplierLinks?.length) {
    const supplierCount = await tx.supplier.count({
      where: { tenantId, id: { in: data.supplierLinks.map((link) => link.supplierId) } },
    })
    if (supplierCount !== data.supplierLinks.length) {
      throw new BusinessError(400, "One or more suppliers do not belong to this tenant.")
    }
  }
  if (data.taxIds?.length) {
    const uniqueTaxIds = [...new Set(data.taxIds)]
    const taxCount = await tx.tax.count({
      where: { tenantId, id: { in: uniqueTaxIds }, isActive: true },
    })
    if (taxCount !== uniqueTaxIds.length) {
      throw new BusinessError(400, "One or more taxes were not found in this tenant.")
    }
  }

}

export async function readProduct(tx: Prisma.TransactionClient, tenantId: string, id: string, officeId: string) {
  const item = await tx.inventoryProduct.findFirst({ where: { tenantId, id }, select: productSelect(officeId) })
  if (!item) throw new BusinessError(404, "Product not found.")
  return serializeProduct(item, await inventoryOfficeLabel(tx, tenantId, officeId))
}
export function getProduct(actor: BusinessActor, id: string, officeId?: string) {
  return inventoryRead(actor, "inventoryProducts", async tx => readProduct(tx, actor.tenantId, id, await stockOffice(tx, actor.tenantId, officeId)))
}
export function listProducts(actor: BusinessActor, query: z.infer<typeof productListSchema>) {
  return inventoryRead(actor, "inventoryProducts", async tx => {
    const { page, pageSize, sort, q, status, categoryId } = query
    const officeId = await stockOffice(tx, actor.tenantId, query.officeId)
    const office = await inventoryOfficeLabel(tx, actor.tenantId, officeId)
    const where = Prisma.sql`p."tenantId"=${actor.tenantId}
      ${q ? Prisma.sql`AND (p.name ILIKE ${'%'+q+'%'} OR p.sku ILIKE ${'%'+q+'%'} OR p.description ILIKE ${'%'+q+'%'})` : Prisma.empty}
      ${status ? Prisma.sql`AND p.status::text=${status}` : Prisma.empty}
      ${categoryId ? Prisma.sql`AND p."categoryId"=${categoryId}` : Prisma.empty}`
    const column = sort === "category" ? 'c.name' : sort === "onHandQty" || sort === "costPriceCents" ? `COALESCE(s."${sort}",0)` : `p."${sort ?? 'createdAt'}"`
    const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::integer total FROM "InventoryProduct" p WHERE ${where}`
    const ids = await tx.$queryRaw<{ id: string }[]>`SELECT p.id FROM "InventoryProduct" p JOIN "InventoryCategory" c ON c.id=p."categoryId" LEFT JOIN "InventoryOfficeStock" s ON s."tenantId"=p."tenantId" AND s."productId"=p.id AND s."officeId"=${officeId} WHERE ${where} ORDER BY ${Prisma.raw(column)} ${Prisma.raw(query.order ?? (sort ? "asc" : "desc"))},p.id LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`
    const products = await tx.inventoryProduct.findMany({ where: { tenantId: actor.tenantId, id: { in: ids.map(r=>r.id) } }, select: productSelect(officeId) })
    const byId = new Map(products.map(p=>[p.id,p]))
    return { items: ids.map(r=>serializeProduct(byId.get(r.id)!,office)), office, page, pageSize, total: count.total, totalPages: Math.max(1,Math.ceil(count.total/pageSize)) }
  })
}

// Called within the authorized inventory API tenant context.
export async function createProduct(actor: BusinessActor, data: CreateInventoryProductInput) {
  return inventoryMutation(actor, "inventoryProducts", "create", { status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    const existing = await tx.inventoryProduct.findFirst({
      where: { tenantId, sku: data.sku.trim() },
      select: { id: true },
    })
    if (existing) {
      throw new BusinessError(409, "SKU already exists.")
    }

    await validateProductRelations(tx, tenantId, data)

    const item = await tx.inventoryProduct.create({
      data: {
        tenantId,
        sku: data.sku.trim(),
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        unit: data.unit ?? "unit",
        categoryId: data.categoryId,
        status: data.status ?? "ACTIVE",
        mrpCents: data.mrpCents,
        isPhysical: data.isPhysical ?? true,
        taxes: data.taxIds.length
          ? {
            create: [...new Set(data.taxIds)].map((taxId) => ({ taxId })),
          }
          : undefined,
        suppliers: data.supplierLinks.length
          ? {
            create: data.supplierLinks.map((link) => ({
              supplierId: link.supplierId,
              supplierSku: link.supplierSku?.trim() || undefined,
              supplierCostCents: link.supplierCostCents,
              minOrderQty: link.minOrderQty ?? 1,
              leadTimeDays: link.leadTimeDays,
              isPreferred: link.isPreferred ?? false,
            })),
          }
          : undefined,
      },
      select: { id: true },
    })

    const [context] = await tx.$queryRaw<{ id: string }[]>`SELECT app.inventory_creation_office(${tenantId},'inventoryProducts') id`
    await tx.$queryRaw`SELECT app.inventory_set_stock(${tenantId},${context.id},${item.id},${data.onHandQty ?? 0}::integer,${data.costPriceCents}::integer,${data.reorderPoint ?? 0}::integer,${data.reorderQty ?? 0}::integer,0,${actor.requestId ?? null})`
    return readProduct(tx,tenantId,item.id,context.id)
  })
}

// Called within the authorized inventory API tenant context.
export async function updateProduct(actor: BusinessActor, id: string, data: UpdateInventoryProductInput) {
  return inventoryMutation(actor, "inventoryProducts", "edit", { id, status: data.status }, async (tx, actor) => {
    const { tenantId } = actor
    const changesStock = [data.onHandQty,data.costPriceCents,data.reorderPoint,data.reorderQty].some(v=>v!==undefined)
    if (changesStock && (!data.officeId || data.stockVersion === undefined)) throw new BusinessError(400,"Stock changes require the saved office and stock version. Refresh before saving.")
    const officeId = await stockOffice(tx,tenantId,data.officeId)

    if (data.sku?.trim()) {
      const existing = await tx.inventoryProduct.findUnique({
        where: { tenantId_sku: { tenantId, sku: data.sku.trim() } },
        select: { id: true },
      })
      if (existing && existing.id !== id) {
        throw new BusinessError(409, "SKU already exists.")
      }
    }

    await validateProductRelations(tx, tenantId, data)

    const updated = await tx.inventoryProduct.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.sku?.trim() ? { sku: data.sku.trim() } : {}),
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description?.trim() || null }
          : {}),
        ...(data.unit ? { unit: data.unit } : {}),
        ...(data.categoryId ? { categoryId: data.categoryId } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(typeof data.mrpCents === "number" ? { mrpCents: data.mrpCents } : {}),
        ...(typeof data.isPhysical === "boolean" ? { isPhysical: data.isPhysical } : {}),
      },
    })
    if (!updated.count) return null

    if (data.taxIds) {
      await tx.inventoryProductTax.deleteMany({ where: { productId: id } })
      if (data.taxIds.length > 0) {
        await tx.inventoryProductTax.createMany({
          data: [...new Set(data.taxIds)].map((taxId) => ({
            productId: id,
            taxId,
          })),
        })
      }
    }

    if (data.supplierLinks) {
      await tx.inventoryProductSupplier.deleteMany({ where: { productId: id } })
      if (data.supplierLinks.length > 0) {
        await tx.inventoryProductSupplier.createMany({
          data: data.supplierLinks.map((link) => ({
            productId: id,
            supplierId: link.supplierId,
            supplierSku: link.supplierSku?.trim() || null,
            supplierCostCents: link.supplierCostCents,
            minOrderQty: link.minOrderQty ?? 1,
            leadTimeDays: link.leadTimeDays,
            isPreferred: link.isPreferred ?? false,
          })),
        })
      }
    }

    if (changesStock) await tx.$queryRaw`SELECT app.inventory_set_stock(${tenantId},${officeId},${id},${data.onHandQty ?? null}::integer,${data.costPriceCents ?? null}::integer,${data.reorderPoint ?? null}::integer,${data.reorderQty ?? null}::integer,${data.stockVersion!}::integer,${actor.requestId ?? null})`
    return readProduct(tx,tenantId,id,officeId)
  })
}

// Called within the authorized inventory API tenant context.
export async function archiveProduct(actor: BusinessActor, id: string) {
  return inventoryMutation(actor, "inventoryProducts", "archive", { id }, async (tx, actor) => {
    const { tenantId } = actor

    const linkedPurchases = await tx.purchaseOrderItem.count({
      where: { productId: id, order: { tenantId } },
    })
    const hasStockMovements = await tx.inventoryStockMovement.count({
      where: { productId: id, tenantId },
    })

    const [integrity] = await tx.$queryRaw<{ used: boolean }[]>`SELECT app.inventory_product_referenced(${tenantId},${id}) used`
    if (integrity.used) {
      await tx.inventoryProduct.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await tx.inventoryProduct.deleteMany({ where: { id, tenantId } })
    }

    return { linkedPurchases, hasStockMovements, archived: integrity.used }
  })
}
