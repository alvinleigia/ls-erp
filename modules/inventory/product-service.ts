import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { inventoryProductStatusSchema, type CreateInventoryProductInput, type UpdateInventoryProductInput } from "@/lib/validation"
import { BusinessError } from "@/platform/policy"

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
})


const productSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  unit: true,
  status: true,
  costPriceCents: true,
  mrpCents: true,
  reorderPoint: true,
  reorderQty: true,
  onHandQty: true,
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
} satisfies Prisma.InventoryProductSelect

export const serializeProduct = (item: Prisma.InventoryProductGetPayload<{ select: typeof productSelect }>) => ({
  id: item.id,
  sku: item.sku,
  name: item.name,
  description: item.description,
  unit: item.unit,
  status: item.status,
  costPriceCents: item.costPriceCents,
  mrpCents: item.mrpCents,
  reorderPoint: item.reorderPoint,
  reorderQty: item.reorderQty,
  onHandQty: item.onHandQty,
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

async function validateProductRelations(tenantId: string, data: UpdateInventoryProductInput) {
  if (data.supplierLinks?.length) {
    const preferredCount = data.supplierLinks.filter((link) => link.isPreferred).length
    if (preferredCount > 1) {
      throw new BusinessError(400, "Only one preferred supplier can be selected.")
    }
  }

  if (data.categoryId) {
    const category = await prisma.inventoryCategory.findFirst({
      where: { id: data.categoryId, tenantId },
      select: { id: true },
    })
    if (!category) {
      throw new BusinessError(404, "Category not found.")
    }
  }
  if (data.supplierLinks?.length) {
    const supplierCount = await prisma.supplier.count({
      where: { tenantId, id: { in: data.supplierLinks.map((link) => link.supplierId) } },
    })
    if (supplierCount !== data.supplierLinks.length) {
      throw new BusinessError(400, "One or more suppliers do not belong to this tenant.")
    }
  }
  if (data.taxIds?.length) {
    const uniqueTaxIds = [...new Set(data.taxIds)]
    const taxCount = await prisma.tax.count({
      where: { tenantId, id: { in: uniqueTaxIds }, isActive: true },
    })
    if (taxCount !== uniqueTaxIds.length) {
      throw new BusinessError(400, "One or more taxes were not found in this tenant.")
    }
  }

}

// Called within the authorized inventory API tenant context.
export async function listProducts(tenantId: string, query: z.infer<typeof productListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, sort, order, q, status, categoryId } = query
  const skip = (page - 1) * pageSize
  const sortDirection = order ?? "asc"
  const orderBy =
    sort === "category"
      ? { category: { name: sortDirection } }
      : sort
        ? { [sort]: sortDirection }
        : { createdAt: "desc" as const }
  const where: Prisma.InventoryProductWhereInput = {
    tenantId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.inventoryProduct.count({ where }),
    prisma.inventoryProduct.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: productSelect,
    }),
  ])

  return { items: items.map(serializeProduct), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

// Called within the authorized inventory API tenant context.
export async function createProduct(tenantId: string, data: CreateInventoryProductInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const existing = await prisma.inventoryProduct.findFirst({
    where: { tenantId, sku: data.sku.trim() },
    select: { id: true },
  })
  if (existing) {
    throw new BusinessError(409, "SKU already exists.")
  }

  await validateProductRelations(tenantId, data)

  const item = await prisma.inventoryProduct.create({
    data: {
      tenantId,
      sku: data.sku.trim(),
      name: data.name.trim(),
      description: data.description?.trim() || undefined,
      unit: data.unit ?? "unit",
      categoryId: data.categoryId,
      status: data.status ?? "ACTIVE",
      costPriceCents: data.costPriceCents,
      mrpCents: data.mrpCents,
      reorderPoint: data.reorderPoint ?? 0,
      reorderQty: data.reorderQty ?? 0,
      onHandQty: data.onHandQty ?? 0,
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
    select: productSelect,
  })

  return item
}

// Called within the authorized inventory API tenant context.
export async function updateProduct(tenantId: string, id: string, data: UpdateInventoryProductInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (data.sku?.trim()) {
    const existing = await prisma.inventoryProduct.findUnique({
      where: { tenantId_sku: { tenantId, sku: data.sku.trim() } },
      select: { id: true },
    })
    if (existing && existing.id !== id) {
      throw new BusinessError(409, "SKU already exists.")
    }
  }

  await validateProductRelations(tenantId, data)

  const item = await prisma.$transaction(async (tx) => {
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
        ...(typeof data.costPriceCents === "number"
          ? { costPriceCents: data.costPriceCents }
          : {}),
        ...(typeof data.mrpCents === "number" ? { mrpCents: data.mrpCents } : {}),
        ...(typeof data.reorderPoint === "number" ? { reorderPoint: data.reorderPoint } : {}),
        ...(typeof data.reorderQty === "number" ? { reorderQty: data.reorderQty } : {}),
        ...(typeof data.onHandQty === "number" ? { onHandQty: data.onHandQty } : {}),
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

    return tx.inventoryProduct.findFirst({
      where: { id, tenantId },
      select: productSelect,
    })
  })

  return item
}

// Called within the authorized inventory API tenant context.
export async function archiveProduct(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const linkedPurchases = await prisma.purchaseOrderItem.count({
    where: { productId: id, order: { tenantId } },
  })
  const hasStockMovements = await prisma.inventoryStockMovement.count({
    where: { productId: id, tenantId },
  })

  if (linkedPurchases > 0 || hasStockMovements > 0) {
    await prisma.inventoryProduct.updateMany({
      where: { id, tenantId },
      data: { status: "INACTIVE" },
    })
  } else {
    await prisma.inventoryProduct.deleteMany({ where: { id, tenantId } })
  }

  return { linkedPurchases, hasStockMovements }
}
