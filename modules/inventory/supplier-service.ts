import { inventoryMutation } from "./transaction"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { supplierStatusSchema, type CreateSupplierInput, type UpdateSupplierInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export const supplierListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "status"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: supplierStatusSchema.optional(),
})

const supplierSelect = {
  id: true,
  name: true,
  contactPerson: true,
  email: true,
  phone: true,
  isTaxRegistered: true,
  taxRegistrationType: true,
  taxRegistrationNumber: true,
  leadTimeDays: true,
  status: true,
  city: true,
  state: true,
  country: true,
  createdAt: true,
  notes: true,
} satisfies Prisma.SupplierSelect

// Runs inside the authorized module API tenant context.
export async function listSuppliers(tenantId: string, query: z.infer<typeof supplierListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, sort, order, q, status } = query
  const skip = (page - 1) * pageSize
  const orderBy = sort
    ? { [sort]: order ?? "asc" }
    : { name: "asc" as const }

  const where: Prisma.SupplierWhereInput = {
    tenantId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { contactPerson: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      select: supplierSelect,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { items, page, pageSize, total, totalPages }
}

// Runs inside the authorized module API tenant context.
export async function createSupplier(actor: BusinessActor, data: CreateSupplierInput) {
  return inventoryMutation(actor, "inventorySuppliers", "create", { status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    const supplier = await tx.supplier.create({
      data: {
        tenantId,
        name: data.name.trim(),
        contactPerson: data.contactPerson?.trim() || undefined,
        email: data.email?.trim() || undefined,
        phone: data.phone?.trim() || undefined,
        isTaxRegistered: data.isTaxRegistered ?? false,
        taxRegistrationType: data.isTaxRegistered ? data.taxRegistrationType : null,
        taxRegistrationNumber: data.isTaxRegistered
          ? data.taxRegistrationNumber?.trim() || undefined
          : undefined,
        leadTimeDays: data.leadTimeDays ?? 0,
        addressLine1: data.addressLine1?.trim() || undefined,
        addressLine2: data.addressLine2?.trim() || undefined,
        city: data.city?.trim() || undefined,
        state: data.state?.trim() || undefined,
        postalCode: data.postalCode?.trim() || undefined,
        country: data.country?.trim() || undefined,
        notes: data.notes?.trim() || undefined,
        status: data.status ?? "ACTIVE",
      },
      select: supplierSelect,
    })
    return supplier
  })
}

// Runs inside the authorized module API tenant context.
export async function updateSupplier(actor: BusinessActor, id: string, data: UpdateSupplierInput) {
  return inventoryMutation(actor, "inventorySuppliers", "edit", { id, status: data.status }, async (tx, actor) => {
    const { tenantId } = actor

    const supplier = await tx.supplier.updateManyAndReturn({
      where: { id, tenantId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.contactPerson !== undefined
          ? { contactPerson: data.contactPerson?.trim() || null }
          : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.isTaxRegistered !== undefined ? { isTaxRegistered: data.isTaxRegistered } : {}),
        ...(data.taxRegistrationType !== undefined
          ? { taxRegistrationType: data.taxRegistrationType || null }
          : {}),
        ...(data.taxRegistrationNumber !== undefined
          ? { taxRegistrationNumber: data.taxRegistrationNumber?.trim() || null }
          : {}),
        ...(typeof data.leadTimeDays === "number" ? { leadTimeDays: data.leadTimeDays } : {}),
        ...(data.addressLine1 !== undefined
          ? { addressLine1: data.addressLine1?.trim() || null }
          : {}),
        ...(data.addressLine2 !== undefined
          ? { addressLine2: data.addressLine2?.trim() || null }
          : {}),
        ...(data.city !== undefined ? { city: data.city?.trim() || null } : {}),
        ...(data.state !== undefined ? { state: data.state?.trim() || null } : {}),
        ...(data.postalCode !== undefined
          ? { postalCode: data.postalCode?.trim() || null }
          : {}),
        ...(data.country !== undefined ? { country: data.country?.trim() || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
      select: supplierSelect,
    })

    if (!supplier[0]) {
      throw new BusinessError(404, "Supplier not found.")
    }
    return supplier[0]
  })
}

// Runs inside the authorized module API tenant context.
export async function archiveSupplier(actor: BusinessActor, id: string) {
  return inventoryMutation(actor, "inventorySuppliers", "archive", { id }, async (tx, actor) => {
    const { tenantId } = actor

    const linkedProducts = await tx.inventoryProductSupplier.count({
      where: { supplierId: id, product: { tenantId } },
    })
    const linkedPurchases = await tx.purchaseOrder.count({
      where: { supplierId: id, tenantId },
    })

    if (linkedProducts > 0 || linkedPurchases > 0) {
      await tx.supplier.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await tx.supplier.deleteMany({ where: { id, tenantId } })
    }
    return { linkedProducts, linkedPurchases }
  })
}
