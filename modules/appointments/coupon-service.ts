import { Prisma, type Coupon } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { CouponCreateInput, CouponUpdateInput } from "@/lib/validation"
import type { CouponRow } from "@/types/appointments"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { requireBusinessModule } from "@/platform/module-server"
import { appointmentTransaction } from "./appointment-transaction"
import type { CouponListInput } from "./coupon-validation"

export const serializeCoupon = (coupon: Coupon): CouponRow => ({
  id: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discountType, discountValue: coupon.discountValue,
  appliesTo: coupon.appliesTo, allowedServiceIds: coupon.allowedServiceIds, allowedCategoryIds: coupon.allowedCategoryIds,
  allowedProductIds: coupon.allowedProductIds, minSubtotalCents: coupon.minSubtotalCents, stackingMode: coupon.stackingMode,
  isActive: coupon.isActive, maxUses: coupon.maxUses, maxUsesPerCustomer: coupon.maxUsesPerCustomer, usedCount: coupon.usedCount,
  validFrom: coupon.validFrom?.toISOString().slice(0, 10) ?? null,
  validTo: coupon.validTo?.toISOString().slice(0, 10) ?? null,
  createdAt: coupon.createdAt.toISOString(), updatedAt: coupon.updatedAt.toISOString(),
})

export async function listCoupons(tenantId: string, { page, pageSize, q, active }: CouponListInput) {
  const where: Prisma.CouponWhereInput = { tenantId, isActive: active,
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}) }
  const [total, rows] = await prisma.$transaction([
    prisma.coupon.count({ where }),
    prisma.coupon.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ])
  const usage = rows.length ? await prisma.appointmentOrderCoupon.groupBy({ by: ["code"], _count: { _all: true },
    where: { code: { in: rows.map(row => row.code) }, order: { tenantId, status: { not: "CANCELED" } } } }) : []
  const counts = new Map(usage.map(row => [row.code, row._count._all]))
  return { items: rows.map(row => serializeCoupon({ ...row, usedCount: counts.get(row.code) ?? 0 })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

const dateValue = (value: string | undefined) => value === undefined ? undefined : value ? new Date(`${value}T00:00:00.000Z`) : null
const couponData = (input: CouponUpdateInput) => ({ ...input,
  code: input.code?.toUpperCase(), name: input.name === undefined ? undefined : input.name || null,
  validFrom: dateValue(input.validFrom), validTo: dateValue(input.validTo),
})

async function validateChange(tx: Prisma.TransactionClient, actor: BusinessActor, input: CouponUpdateInput, before?: Coupon) {
  if (input.isActive !== undefined && input.isActive !== (before?.isActive ?? true)) requirePermission(actor, "appointmentCoupons.archive")
  for (const field of ["allowedServiceIds", "allowedCategoryIds", "allowedProductIds"] as const) {
    const ids = input[field]
    if (ids === undefined || JSON.stringify(ids) === JSON.stringify(before?.[field] ?? [])) continue
    if (field === "allowedProductIds") {
      await requireBusinessModule(tx, actor.tenantId, "inventory")
      requirePermission(actor, "inventoryProducts.read")
    } else {
      await requireBusinessModule(tx, actor.tenantId, "services")
      requirePermission(actor, field === "allowedServiceIds" ? "services.read" : "serviceCategories.read")
    }
    const where = { tenantId: actor.tenantId, id: { in: ids } }
    const count = field === "allowedProductIds" ? await tx.inventoryProduct.count({ where })
      : field === "allowedServiceIds" ? await tx.service.count({ where }) : await tx.serviceCategory.count({ where })
    if (count !== new Set(ids).size) throw new BusinessError(400, "Coupon eligibility includes unavailable records.")
  }
  const from = input.validFrom === undefined ? before?.validFrom : dateValue(input.validFrom)
  const to = input.validTo === undefined ? before?.validTo : dateValue(input.validTo)
  if (from && to && from > to) throw new BusinessError(400, "Valid from must be before valid to.")
  if ((input.discountType ?? before?.discountType) === "PERCENT" && (input.discountValue ?? before?.discountValue ?? 0) > 100) {
    throw new BusinessError(400, "Percentage discount cannot exceed 100.")
  }
}

async function usedCoupon(tx: Prisma.TransactionClient, coupon: Coupon) {
  if (!coupon.tenantId) throw new BusinessError(403, "Coupon tenant context is required.")
  if (coupon.usedCount > 0) return true
  const [row] = await tx.$queryRaw<{ used: boolean }[]>`SELECT app.booking_coupon_used(${coupon.tenantId},${coupon.code}) AS used`
  return row.used
}

async function audit(tx: Prisma.TransactionClient, actor: BusinessActor, action: string, before: Coupon | null, after: Coupon | null) {
  await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: `appointments.coupon.${action}`, entityType: "coupon", entityId: (after ?? before)!.id,
    ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}),
    ...(after ? { after: JSON.parse(JSON.stringify(after)) } : {}),
  })
}

async function couponTransaction<T>(actor: BusinessActor, action: "create" | "edit" | "archive",
  write: (tx: Prisma.TransactionClient, currentActor: BusinessActor) => Promise<T>) {
  try { return await appointmentTransaction(actor, action, write, "appointmentCoupons") }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BusinessError(409, "Coupon code already exists.")
    throw error
  }
}

export async function createCoupon(actor: BusinessActor, input: CouponCreateInput) {
  return couponTransaction(actor, "create", async (tx, actor) => {
    await validateChange(tx, actor, input)
    const coupon = await tx.coupon.create({ data: { ...input, ...couponData(input), code: input.code.toUpperCase(), tenantId: actor.tenantId } })
    await audit(tx, actor, "create", null, coupon)
    return serializeCoupon(coupon)
  })
}

export async function updateCoupon(actor: BusinessActor, id: string, input: CouponUpdateInput) {
  return couponTransaction(actor, "edit", async (tx, actor) => {
    const before = await tx.coupon.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!before) throw new BusinessError(404, "Coupon not found.")
    await validateChange(tx, actor, input, before)
    // Saved orders identify coupons by code. A rename must not detach usage/history.
    if (input.code !== undefined && input.code.toUpperCase() !== before.code && await usedCoupon(tx, before)) {
      throw new BusinessError(409, "A used coupon cannot be renamed. Create a new coupon instead.")
    }
    const after = await tx.coupon.update({ where: { tenantId: actor.tenantId, id }, data: couponData(input) })
    await audit(tx, actor, "edit", before, after)
    const usedCount = await tx.appointmentOrderCoupon.count({ where: { code: after.code, order: { tenantId: actor.tenantId, status: { not: "CANCELED" } } } })
    return serializeCoupon({ ...after, usedCount })
  })
}

export async function deleteCoupon(actor: BusinessActor, id: string) {
  return couponTransaction(actor, "archive", async (tx, actor) => {
    const before = await tx.coupon.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!before) throw new BusinessError(404, "Coupon not found.")
    const used = await usedCoupon(tx, before)
    const after = used ? await tx.coupon.update({ where: { tenantId: actor.tenantId, id }, data: { isActive: false } }) : null
    if (!used) await tx.coupon.delete({ where: { tenantId: actor.tenantId, id } })
    await audit(tx, actor, "archive", before, after)
    return { ok: true }
  })
}
