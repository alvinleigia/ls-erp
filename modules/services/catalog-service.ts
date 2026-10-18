import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { serviceStatusSchema, serviceTypeSchema, type CreateServiceInput, type UpdateServiceInput } from "@/lib/validation"
import { BusinessError } from "@/platform/policy"

export const serviceListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      "createdAt",
      "name",
      "status",
      "durationMinutes",
      "priceCents",
      "type",
      "category",
    ])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: serviceStatusSchema.optional(),
  categoryId: z.string().trim().optional(),
  type: serviceTypeSchema.optional(),
})

const serviceSelect = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  priceCents: true,
  status: true,
  type: true,
  taxMode: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  packageItems: {
    select: { itemService: { select: { id: true, name: true } } },
  },
  defaultTaxes: { select: { taxId: true } },
} satisfies Prisma.ServiceSelect

async function validateServiceRelations(tenantId: string, data: Pick<UpdateServiceInput, "categoryId" | "packageItemIds" | "taxIds">) {
  if (data.categoryId) {
    const category = await prisma.serviceCategory.findFirst({
      where: { id: data.categoryId, tenantId },
      select: { id: true },
    })
    if (!category) {
      throw new BusinessError(404, "Service category not found.")
    }
  }
  if (data.packageItemIds?.length) {
    const packageItemsCount = await prisma.service.count({
      where: { tenantId, id: { in: data.packageItemIds } },
    })
    if (packageItemsCount !== data.packageItemIds.length) {
      throw new BusinessError(400, "One or more package services were not found in this tenant.")
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

// Runs inside the authorized module API tenant context.
export async function listServices(tenantId: string, query: z.infer<typeof serviceListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, sort, order, q, status, categoryId, type } = query
  const skip = (page - 1) * pageSize
  const sortDir = order ?? "asc"
  const orderBy =
    sort === "category"
      ? { category: { name: sortDir } }
      : sort
        ? { [sort]: sortDir }
        : { createdAt: "desc" as const }
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
    ...(categoryId ? { categoryId } : {}),
    ...(type ? { type } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.service.count({ where }),
    prisma.service.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: serviceSelect,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { items, page, pageSize, total, totalPages }
}

// Runs inside the authorized module API tenant context.
export async function createService(tenantId: string, data: CreateServiceInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const {
    name,
    description,
    categoryId,
    durationMinutes,
    priceCents,
    status,
    type,
    packageItemIds,
    taxIds,
    taxMode,
  } = data

  if (type === "PACKAGE" && (!packageItemIds || packageItemIds.length === 0)) {
    throw new BusinessError(400, "Package items are required.")
  }

  await validateServiceRelations(tenantId, data)

  const item = await prisma.service.create({
    data: {
      tenantId,
      name: name.trim(),
      description: description?.trim() || undefined,
      categoryId,
      durationMinutes,
      priceCents,
      status: status ?? "ACTIVE",
      type: type ?? "STANDARD",
      taxMode,
      packageItems:
        type === "PACKAGE" && packageItemIds?.length
          ? {
              create: packageItemIds.map((itemServiceId, index) => ({
                itemServiceId,
                sortOrder: index,
              })),
            }
          : undefined,
      defaultTaxes: taxIds?.length
        ? {
            create: [...new Set(taxIds)].map((taxId) => ({ taxId })),
          }
        : undefined,
    },
    select: serviceSelect,
  })
  return item
}

// Runs inside the authorized module API tenant context.
export async function updateService(tenantId: string, id: string, data: UpdateServiceInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (data.type === "PACKAGE" && data.packageItemIds?.length === 0) {
    throw new BusinessError(400, "Package items are required.")
  }

  await validateServiceRelations(tenantId, data)

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.service.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.description?.trim()
          ? { description: data.description.trim() }
          : data.description === ""
            ? { description: null }
            : {}),
        ...(data.categoryId ? { categoryId: data.categoryId } : {}),
        ...(typeof data.durationMinutes === "number"
          ? { durationMinutes: data.durationMinutes }
          : {}),
        ...(typeof data.priceCents === "number"
          ? { priceCents: data.priceCents }
          : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.type ? { type: data.type } : {}),
        ...(data.taxMode ? { taxMode: data.taxMode } : {}),

      },
    })
    if (!updated.count) {
      return null
    }

    if (data.taxIds) {
      await tx.serviceTax.deleteMany({ where: { serviceId: id, service: { tenantId } } })
      if (data.taxIds.length) await tx.serviceTax.createMany({ data: [...new Set(data.taxIds)].map(taxId => ({ serviceId: id, taxId })) })
    }
    if (data.packageItemIds) {
      await tx.servicePackageItem.deleteMany({
        where: { packageId: id, package: { tenantId } },
      })
      if (data.packageItemIds.length > 0) {
        await tx.servicePackageItem.createMany({
          data: data.packageItemIds.map((itemServiceId, index) => ({
            packageId: id,
            itemServiceId,
            sortOrder: index,
          })),
        })
      }
    }

    return tx.service.findFirst({
      where: { id, tenantId },
      select: serviceSelect,
    })
  })
  return item
}

// Runs inside the authorized module API tenant context.
export async function archiveService(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const packageAssociations = await prisma.servicePackageItem.count({
    where: {
      package: { tenantId },
      OR: [{ packageId: id }, { itemServiceId: id }],
    },
  })

  const [appointments, orderLines, eligibility] = await Promise.all([
    prisma.appointment.count({ where: { tenantId, serviceId: id } }),
    prisma.appointmentOrderLine.count({ where: { serviceId: id, order: { tenantId } } }),
    prisma.staffServiceEligibility.count({ where: { serviceId: id, user: { tenantId } } }),
  ])
  const associations = packageAssociations + appointments + orderLines + eligibility
  if (associations > 0) {
    await prisma.service.updateMany({
      where: { id, tenantId },
      data: { status: "INACTIVE" },
    })
  } else {
    await prisma.service.deleteMany({ where: { id, tenantId } })
  }
  return { associations }
}
