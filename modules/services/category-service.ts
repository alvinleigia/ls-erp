import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { serviceCategoryStatusSchema, type CreateServiceCategoryInput, type UpdateServiceCategoryInput } from "@/lib/validation"
import { BusinessError } from "@/platform/policy"

export const serviceCategoryListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "status", "sortOrder"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: serviceCategoryStatusSchema.optional(),
})

const serviceCategorySelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  sortOrder: true,
  createdAt: true,
} satisfies Prisma.ServiceCategorySelect

// Runs inside the authorized module API tenant context.
export async function listServiceCategories(tenantId: string, query: z.infer<typeof serviceCategoryListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, sort, order, q, status } = query
  const skip = (page - 1) * pageSize
  const orderBy = sort
    ? { [sort]: order ?? "asc" }
    : { sortOrder: "asc" as const }
  const trimmedSearch = q?.trim()

  const where = {
    tenantId,
    ...(trimmedSearch
      ? {
          OR: [
            { name: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
            { description: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.serviceCategory.count({ where }),
    prisma.serviceCategory.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: serviceCategorySelect,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { items, page, pageSize, total, totalPages }
}

// Runs inside the authorized module API tenant context.
export async function createServiceCategory(tenantId: string, data: CreateServiceCategoryInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { name, description, status, sortOrder } = data
  const existing = await prisma.serviceCategory.findFirst({
    where: { tenantId, name: name.trim() },
    select: { id: true },
  })
  if (existing) {
    throw new BusinessError(409, "Category name already exists.")
  }

  const item = await prisma.serviceCategory.create({
    data: {
      tenantId,
      name: name.trim(),
      description: description?.trim() || undefined,
      status: status ?? "ACTIVE",
      sortOrder: sortOrder ?? 0,
    },
    select: serviceCategorySelect,
  })
  return item
}

// Runs inside the authorized module API tenant context.
export async function updateServiceCategory(tenantId: string, id: string, data: UpdateServiceCategoryInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (data.name?.trim()) {
    const existing = await prisma.serviceCategory.findFirst({
      where: { tenantId, name: data.name.trim() },
      select: { id: true },
    })
    if (existing && existing.id !== id) {
      throw new BusinessError(409, "Category name already exists.")
    }
  }

  const item = await prisma.serviceCategory.updateManyAndReturn({
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
    select: serviceCategorySelect,
  })
  return item[0] ?? null
}

// Runs inside the authorized module API tenant context.
export async function archiveServiceCategory(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const linkedServices = await prisma.service.count({
    where: { tenantId, categoryId: id },
  })
  if (linkedServices > 0) {
    await prisma.serviceCategory.updateMany({
      where: { id, tenantId },
      data: { status: "INACTIVE" },
    })
  } else {
    await prisma.serviceCategory.deleteMany({ where: { id, tenantId } })
  }
  return { linkedServices }
}
