import { inventoryMutation } from "./transaction"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { inventoryCategoryStatusSchema, type CreateInventoryCategoryInput, type UpdateInventoryCategoryInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export const inventoryCategoryListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "status", "sortOrder"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: inventoryCategoryStatusSchema.optional(),
})

const inventoryCategorySelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  sortOrder: true,
  createdAt: true,
} satisfies Prisma.InventoryCategorySelect

// Runs inside the authorized module API tenant context.
export async function listInventoryCategories(tenantId: string, query: z.infer<typeof inventoryCategoryListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, sort, order, q, status } = query
  const skip = (page - 1) * pageSize
  const orderBy = sort
    ? { [sort]: order ?? "asc" }
    : { sortOrder: "asc" as const }

  const where: Prisma.InventoryCategoryWhereInput = {
    tenantId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.inventoryCategory.count({ where }),
    prisma.inventoryCategory.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: inventoryCategorySelect,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { items, page, pageSize, total, totalPages }
}

// Runs inside the authorized module API tenant context.
export async function createInventoryCategory(actor: BusinessActor, data: CreateInventoryCategoryInput) {
  return inventoryMutation(actor, "inventoryCategories", "create", { status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    const existing = await tx.inventoryCategory.findFirst({
      where: { tenantId, name: data.name.trim() },
      select: { id: true },
    })
    if (existing) {
      throw new BusinessError(409, "Category name already exists.")
    }

    const item = await tx.inventoryCategory.create({
      data: {
        tenantId,
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        status: data.status ?? "ACTIVE",
        sortOrder: data.sortOrder ?? 0,
      },
      select: inventoryCategorySelect,
    })
    return item
  })
}

// Runs inside the authorized module API tenant context.
export async function updateInventoryCategory(actor: BusinessActor, id: string, data: UpdateInventoryCategoryInput) {
  return inventoryMutation(actor, "inventoryCategories", "edit", { id, status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    if (data.name?.trim()) {
      const existing = await tx.inventoryCategory.findUnique({
        where: { tenantId_name: { tenantId, name: data.name.trim() } },
        select: { id: true },
      })
      if (existing && existing.id !== id) {
        throw new BusinessError(409, "Category name already exists.")
      }
    }

    const item = await tx.inventoryCategory.updateManyAndReturn({
      where: { id, tenantId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.description?.trim()
          ? { description: data.description.trim() }
          : data.description === ""
            ? { description: null }
            : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
      },
      select: inventoryCategorySelect,
    })

    const updatedItem = item[0]
    if (!updatedItem) {
      throw new BusinessError(404, "Category not found.")
    }
    return updatedItem
  })
}

// Runs inside the authorized module API tenant context.
export async function archiveInventoryCategory(actor: BusinessActor, id: string) {
  return inventoryMutation(actor, "inventoryCategories", "archive", { id }, async (tx, actor) => {
    const { tenantId } = actor

    const linkedProducts = await tx.inventoryProduct.count({
      where: { tenantId, categoryId: id },
    })

    if (linkedProducts > 0) {
      await tx.inventoryCategory.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await tx.inventoryCategory.deleteMany({ where: { id, tenantId } })
    }
    return { linkedProducts }
  })
}
