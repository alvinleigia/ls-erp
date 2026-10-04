import { requireServicesAccess } from "@/modules/services/api"
import { prisma } from "@/lib/prisma"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import {
  calculateDiscountCents,
  calculateLineAmounts,
  pickActiveCouponRules,
  resolveCouponRules,
} from "@/lib/appointments/order-pricing"
import type { AppointmentOrderCreateInput } from "@/lib/validation"
import { toDateOnlyUtc } from "./_helpers"

export type ResolvedOrderLine = {
  serviceId: string
  staffProfileId: string
  quantity: number
  durationMinutes: number
  unitPriceCents: number
  discountType: AppointmentOrderCreateInput["lines"][number]["discountType"]
  discountValue: number
  taxMode: AppointmentOrderCreateInput["lines"][number]["taxMode"]
  taxIds: string[]
  taxPercents: Array<{ id: string; name: string; percent: number }>
  lineSubtotalCents: number
  lineDiscountCents: number
  lineTaxCents: number
  lineTotalCents: number
  startAt: Date
  endAt: Date
  note: string | null
  sortOrder: number
}

export type ResolvedOrderProductLine = {
  productId: string
  quantity: number
  unitPriceCents: number
  discountType: AppointmentOrderCreateInput["productLines"][number]["discountType"]
  discountValue: number
  taxMode: AppointmentOrderCreateInput["productLines"][number]["taxMode"]
  taxIds: string[]
  taxPercents: Array<{ id: string; name: string; percent: number }>
  lineSubtotalCents: number
  lineDiscountCents: number
  lineTaxCents: number
  lineTotalCents: number
  note: string | null
  sortOrder: number
}

type ResolvedOrderTax = {
  taxId: string
  name: string
  percent: number
  taxCents: number
}

type ResolveOrderOptions = {
  actor?: BusinessActor
  enforceFutureStartAt?: boolean
  existingOrderId?: string
  tenantId?: string
}

const sumPercent = (values: number[]) =>
  values.reduce((sum, value) => sum + Math.max(0, value), 0)

const extractTaxFromInclusiveGross = (
  grossCents: number,
  taxes: Array<{ percent: number }>
) => {
  const totalPercent = sumPercent(taxes.map((tax) => tax.percent))
  if (grossCents <= 0 || totalPercent <= 0) return 0
  const netCents = Math.round((grossCents * 100) / (100 + totalPercent))
  return Math.max(0, grossCents - netCents)
}

const calculateExclusiveTaxFromNet = (
  netCents: number,
  taxes: Array<{ percent: number }>
) =>
  taxes.reduce(
    (sum, tax) =>
      sum + Math.max(0, Math.round((Math.max(0, netCents) * Math.max(0, tax.percent)) / 100)),
    0
  )

const allocateCouponByWeight = (amounts: number[], couponCents: number) => {
  const total = amounts.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0 || couponCents <= 0) return amounts.map(() => 0)

  const rawAllocations = amounts.map((value) => ({
    base: Math.floor((couponCents * Math.max(0, value)) / total),
    remainder: (couponCents * Math.max(0, value)) % total,
  }))
  let remaining = couponCents - rawAllocations.reduce((sum, item) => sum + item.base, 0)
  const ranked = rawAllocations
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => b.remainder - a.remainder)
  for (let i = 0; i < ranked.length && remaining > 0; i += 1) {
    rawAllocations[ranked[i].index].base += 1
    remaining -= 1
  }
  return rawAllocations.map((item) => item.base)
}

type CouponScopeLine = {
  lineType: "SERVICE" | "PRODUCT"
  serviceId?: string
  serviceCategoryId?: string
  productId?: string
  productCategoryId?: string
}

const isCouponEligibleForLine = (
  coupon: {
    appliesTo?: "ORDER" | "SERVICE_LINES" | "PRODUCT_LINES"
    allowedServiceIds?: string[]
    allowedCategoryIds?: string[]
    allowedProductIds?: string[]
  },
  line: CouponScopeLine
) => {
  const appliesTo = coupon.appliesTo ?? "ORDER"
  if (appliesTo === "SERVICE_LINES" && line.lineType !== "SERVICE") return false
  if (appliesTo === "PRODUCT_LINES" && line.lineType !== "PRODUCT") return false

  const allowedServiceIds = coupon.allowedServiceIds ?? []
  const allowedCategoryIds = coupon.allowedCategoryIds ?? []
  const allowedProductIds = coupon.allowedProductIds ?? []

  if (line.lineType === "SERVICE") {
    if (allowedServiceIds.length && (!line.serviceId || !allowedServiceIds.includes(line.serviceId))) {
      return false
    }
    if (
      allowedCategoryIds.length &&
      (!line.serviceCategoryId || !allowedCategoryIds.includes(line.serviceCategoryId))
    ) {
      return false
    }
  }

  if (line.lineType === "PRODUCT") {
    if (allowedProductIds.length && (!line.productId || !allowedProductIds.includes(line.productId))) {
      return false
    }
    if (
      allowedCategoryIds.length &&
      (!line.productCategoryId || !allowedCategoryIds.includes(line.productCategoryId))
    ) {
      return false
    }
  }

  return true
}

export const resolveOrderData = async (
  input: AppointmentOrderCreateInput,
  options: ResolveOrderOptions = {}
) => {
  const tenantId = options.tenantId
  if (!tenantId) {
    throw new Error("Tenant context is required for order resolution.")
  }
  if (input.productLines?.length) {
    await requireBusinessModule(prisma, tenantId, "inventory")
    if (!options.actor || options.actor.tenantId !== tenantId) throw new BusinessError(403, "Inventory access is required for product lines.")
    requirePermission(options.actor, "inventoryProducts.read")
  }

  if (input.lines?.length) {
    if (!options.actor || options.actor.tenantId !== tenantId) throw new BusinessError(403, "Services access is required for service lines.")
    await requireServicesAccess(options.actor)
  }

  if (input.coupons?.length) {
    if (!options.actor || options.actor.tenantId !== tenantId) throw new BusinessError(403, "Coupon access is required.")
    requirePermission(options.actor, "appointmentCoupons.read")
  }

  const appointmentStartAt = new Date(input.appointmentStartAt)
  if (Number.isNaN(appointmentStartAt.getTime())) {
    throw new Error("Invalid appointment start date/time.")
  }
  if (options.enforceFutureStartAt && appointmentStartAt <= new Date()) {
    throw new Error("Cannot create bookings in the past.")
  }

  const appointmentDate = toDateOnlyUtc(input.appointmentDate)
  const normalizedCouponCodes = resolveCouponRules(input.coupons)

  const normalizedTaxIds = [
    ...new Set([
      ...input.lines.flatMap((line) => line.taxIds ?? []),
      ...(input.productLines ?? []).flatMap((line) => line.taxIds ?? []),
    ]),
  ]
  const [customer, services, products, staffProfiles, couponsFromDb, couponUsageRows, taxesFromDb] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: input.customerId },
        select: { id: true, role: true, status: true },
      }),
      prisma.service.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(input.lines.map((line) => line.serviceId))] },
        },
        select: {
          id: true,
          durationMinutes: true,
          priceCents: true,
          categoryId: true,
          status: true,
          taxMode: true,
          defaultTaxes: { select: { taxId: true } },
        },
      }),
      (input.productLines?.length ?? 0) > 0
        ? prisma.inventoryProduct.findMany({
            where: {
              tenantId,
              id: { in: [...new Set((input.productLines ?? []).map((line) => line.productId))] },
            },
            select: {
              id: true,
              categoryId: true,
              status: true,
              mrpCents: true,
              taxes: { select: { taxId: true } },
            },
          })
        : Promise.resolve([]),
      prisma.staffProfile.findMany({
        where: {
          userId: { in: [...new Set(input.lines.map((line) => line.staffId))] },
          user: { tenantId },
        },
        select: {
          id: true,
          userId: true,
          user: { select: { role: true, status: true } },
        },
      }),
      normalizedCouponCodes.length
        ? prisma.coupon.findMany({
            where: {
              tenantId,
              code: { in: normalizedCouponCodes },
              isActive: true,
              OR: [{ validFrom: null }, { validFrom: { lte: appointmentDate } }],
              AND: [{ OR: [{ validTo: null }, { validTo: { gte: appointmentDate } }] }],
            },
            select: {
              code: true,
              discountType: true,
              discountValue: true,
              maxUsesPerCustomer: true,
              appliesTo: true,
              allowedServiceIds: true,
              allowedCategoryIds: true,
              allowedProductIds: true,
              minSubtotalCents: true,
              stackingMode: true,
            },
          })
        : Promise.resolve([]),
      normalizedCouponCodes.length
        ? prisma.appointmentOrderCoupon.findMany({
            where: {
              code: { in: normalizedCouponCodes },
              order: {
                tenantId,
                customerId: input.customerId,
                status: { not: "CANCELED" },
                ...(options.existingOrderId ? { id: { not: options.existingOrderId } } : {}),
              },
            },
            select: { code: true },
          })
        : Promise.resolve([]),
      normalizedTaxIds.length
        ? prisma.tax.findMany({
            where: { tenantId, id: { in: normalizedTaxIds }, isActive: true },
            select: { id: true, name: true, percent: true },
          })
        : Promise.resolve([]),
    ])
  const customerTenant = await prisma.user.findFirst({
    where: { id: input.customerId, tenantId },
    select: { id: true },
  })

  if (!customer || !customerTenant || customer.role !== "CUSTOMER") {
    throw new Error("Selected customer is invalid.")
  }
  if (customer.status !== "ACTIVE") {
    throw new Error("Customer is not active.")
  }

  const serviceMap = new Map(services.map((service) => [service.id, service]))
  const productMap = new Map(products.map((product) => [product.id, product]))
  const staffProfileMap = new Map(
    staffProfiles.map((staffProfile) => [staffProfile.userId, staffProfile])
  )

  const lines: ResolvedOrderLine[] = []
  const productLines: ResolvedOrderProductLine[] = []
  let cursor = new Date(appointmentStartAt)

  input.lines.forEach((line, index) => {
    const service = serviceMap.get(line.serviceId)
    if (!service) {
      throw new Error(`Service not found for line ${index + 1}.`)
    }
    if (service.status !== "ACTIVE") {
      throw new Error(`Service is inactive for line ${index + 1}.`)
    }

    const staffProfile = staffProfileMap.get(line.staffId)
    if (!staffProfile || staffProfile.user.role !== "STAFF") {
      throw new Error(`Staff member not found for line ${index + 1}.`)
    }
    if (staffProfile.user.status !== "ACTIVE") {
      throw new Error(`Staff member is inactive for line ${index + 1}.`)
    }

    const totalDurationMinutes = service.durationMinutes * line.quantity
    const startAt = new Date(cursor)
    const endAt = new Date(cursor)
    endAt.setMinutes(endAt.getMinutes() + totalDurationMinutes)
    cursor = endAt

    const resolvedUnitPriceCents =
      line.unitPriceCents > 0 ? line.unitPriceCents : service.priceCents

    const amounts = calculateLineAmounts({
      quantity: line.quantity,
      unitPriceCents: resolvedUnitPriceCents,
      discountType: line.discountType,
      discountValue: line.discountValue,
    })
    const resolvedLineTaxIds = (line.taxIds ?? []).length
      ? line.taxIds
      : service.defaultTaxes.map((tax) => tax.taxId)
    const resolvedTaxMode = line.taxMode ?? service.taxMode
    const lineTaxes = resolvedLineTaxIds
      .map((taxId) => taxesFromDb.find((tax) => tax.id === taxId))
      .filter((tax): tax is { id: string; name: string; percent: number } => Boolean(tax))
    const lineTaxCents =
      resolvedTaxMode === "INCLUSIVE"
        ? extractTaxFromInclusiveGross(amounts.lineTotalCents, lineTaxes)
        : calculateExclusiveTaxFromNet(amounts.lineTotalCents, lineTaxes)
    const lineTotalCents =
      resolvedTaxMode === "INCLUSIVE"
        ? amounts.lineTotalCents
        : amounts.lineTotalCents + lineTaxCents

    lines.push({
      serviceId: service.id,
      staffProfileId: staffProfile.id,
      quantity: line.quantity,
      durationMinutes: totalDurationMinutes,
      unitPriceCents: resolvedUnitPriceCents,
      discountType: line.discountType,
      discountValue: line.discountValue,
      taxMode: resolvedTaxMode,
      taxIds: lineTaxes.map((tax) => tax.id),
      taxPercents: lineTaxes,
      lineSubtotalCents: amounts.lineSubtotalCents,
      lineDiscountCents: amounts.lineDiscountCents,
      lineTaxCents,
      lineTotalCents,
      startAt,
      endAt,
      note: line.note?.trim() || null,
      sortOrder: index,
    })
  })

  const inputProductLines = input.productLines ?? []
  inputProductLines.forEach((line, index) => {
    const product = productMap.get(line.productId)
    if (!product) {
      throw new Error(`Product not found for item ${index + 1}.`)
    }
    if (product.status !== "ACTIVE") {
      throw new Error(`Product is inactive for item ${index + 1}.`)
    }

    const resolvedUnitPriceCents =
      line.unitPriceCents > 0 ? line.unitPriceCents : product.mrpCents

    const amounts = calculateLineAmounts({
      quantity: line.quantity,
      unitPriceCents: resolvedUnitPriceCents,
      discountType: line.discountType,
      discountValue: line.discountValue,
    })
    const resolvedTaxIds = (line.taxIds ?? []).length
      ? line.taxIds
      : product.taxes.map((tax) => tax.taxId)
    const resolvedTaxes = resolvedTaxIds
      .map((taxId) => taxesFromDb.find((tax) => tax.id === taxId))
      .filter((tax): tax is { id: string; name: string; percent: number } => Boolean(tax))
    const resolvedTaxMode = line.taxMode ?? "EXCLUSIVE"
    const lineTaxCents =
      resolvedTaxMode === "INCLUSIVE"
        ? extractTaxFromInclusiveGross(amounts.lineTotalCents, resolvedTaxes)
        : calculateExclusiveTaxFromNet(amounts.lineTotalCents, resolvedTaxes)
    const lineTotalCents =
      resolvedTaxMode === "INCLUSIVE"
        ? amounts.lineTotalCents
        : amounts.lineTotalCents + lineTaxCents

    productLines.push({
      productId: product.id,
      quantity: line.quantity,
      unitPriceCents: resolvedUnitPriceCents,
      discountType: line.discountType,
      discountValue: line.discountValue,
      taxMode: resolvedTaxMode,
      taxIds: resolvedTaxes.map((tax) => tax.id),
      taxPercents: resolvedTaxes,
      lineSubtotalCents: amounts.lineSubtotalCents,
      lineDiscountCents: amounts.lineDiscountCents,
      lineTaxCents,
      lineTotalCents,
      note: line.note?.trim() || null,
      sortOrder: index,
    })
  })

  const subtotalCents =
    lines.reduce((sum, line) => sum + line.lineSubtotalCents, 0) +
    productLines.reduce((sum, line) => sum + line.lineSubtotalCents, 0)
  const lineDiscountCents =
    lines.reduce((sum, line) => sum + line.lineDiscountCents, 0) +
    productLines.reduce((sum, line) => sum + line.lineDiscountCents, 0)
  const couponUsageByCode = couponUsageRows.reduce((map, row) => {
    const code = row.code.trim().toUpperCase()
    map.set(code, (map.get(code) ?? 0) + 1)
    return map
  }, new Map<string, number>())
  const couponRules = pickActiveCouponRules(
    normalizedCouponCodes,
    couponsFromDb.map((coupon) => {
      const normalizedCode = coupon.code.trim().toUpperCase()
      return {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        appliesTo: coupon.appliesTo,
        allowedServiceIds: coupon.allowedServiceIds,
        allowedCategoryIds: coupon.allowedCategoryIds,
        allowedProductIds: coupon.allowedProductIds,
        minSubtotalCents: coupon.minSubtotalCents,
        stackingMode: coupon.stackingMode,
        maxUsesPerCustomer: coupon.maxUsesPerCustomer ?? undefined,
        usedByCustomerCount: couponUsageByCode.get(normalizedCode) ?? 0,
      }
    })
  )
  const serviceLineNetBeforeCoupon = lines.map((line) =>
    Math.max(0, line.lineTotalCents - line.lineTaxCents)
  )
  const productLineNetBeforeCoupon = productLines.map((line) =>
    Math.max(0, line.lineTotalCents - line.lineTaxCents)
  )

  const couponScopeLines: CouponScopeLine[] = [
    ...lines.map((line) => ({
      lineType: "SERVICE" as const,
      serviceId: line.serviceId,
      serviceCategoryId: serviceMap.get(line.serviceId)?.categoryId,
    })),
    ...productLines.map((line) => ({
      lineType: "PRODUCT" as const,
      productId: line.productId,
      productCategoryId: productMap.get(line.productId)?.categoryId,
    })),
  ]
  const allLineNetBeforeCoupon = [...serviceLineNetBeforeCoupon, ...productLineNetBeforeCoupon]
  const allLineNetAfterCoupon = [...allLineNetBeforeCoupon]
  const serviceCouponAllocations = serviceLineNetBeforeCoupon.map(() => 0)
  const productCouponAllocations = productLineNetBeforeCoupon.map(() => 0)

  const coupons: Array<{
    code: string
    discountType: AppointmentOrderCreateInput["lines"][number]["discountType"]
    discountValue: number
    discountCents: number
  }> = []

  let hasAppliedAnyCoupon = false
  let hasAppliedExclusiveCoupon = false

  couponRules.forEach((coupon) => {
    if (
      typeof coupon.maxUsesPerCustomer === "number" &&
      coupon.maxUsesPerCustomer > 0 &&
      (coupon.usedByCustomerCount ?? 0) >= coupon.maxUsesPerCustomer
    ) {
      throw new Error(`Coupon ${coupon.code} can only be used ${coupon.maxUsesPerCustomer} time(s) per customer.`)
    }

    if (hasAppliedExclusiveCoupon) return
    if (coupon.stackingMode === "EXCLUSIVE" && hasAppliedAnyCoupon) return

    const eligibleIndices = allLineNetAfterCoupon
      .map((amount, index) => ({ amount, index }))
      .filter(
        ({ amount, index }) =>
          amount > 0 && isCouponEligibleForLine(coupon, couponScopeLines[index])
      )
      .map(({ index }) => index)

    if (!eligibleIndices.length) return

    const eligibleSubtotalCents = eligibleIndices.reduce(
      (sum, index) => sum + allLineNetAfterCoupon[index],
      0
    )
    if (eligibleSubtotalCents < Math.max(0, coupon.minSubtotalCents ?? 0)) {
      return
    }

    const couponDiscountCents = calculateDiscountCents(
      coupon.discountType,
      coupon.discountValue,
      eligibleSubtotalCents
    )
    if (couponDiscountCents <= 0) return

    const eligibleAllocations = allocateCouponByWeight(
      eligibleIndices.map((index) => allLineNetAfterCoupon[index]),
      couponDiscountCents
    )
    eligibleIndices.forEach((lineIndex, allocationIndex) => {
      const allocation = eligibleAllocations[allocationIndex] ?? 0
      allLineNetAfterCoupon[lineIndex] = Math.max(
        0,
        allLineNetAfterCoupon[lineIndex] - allocation
      )
      if (lineIndex < lines.length) {
        serviceCouponAllocations[lineIndex] += allocation
      } else {
        productCouponAllocations[lineIndex - lines.length] += allocation
      }
    })

    coupons.push({
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountCents: couponDiscountCents,
    })

    hasAppliedAnyCoupon = true
    if (coupon.stackingMode === "EXCLUSIVE") {
      hasAppliedExclusiveCoupon = true
    }
  })

  const couponDiscountCents = coupons.reduce((sum, coupon) => sum + coupon.discountCents, 0)

  const lineTaxByLine = lines.map((line, index) => {
    const netAfterCoupon = Math.max(
      0,
      serviceLineNetBeforeCoupon[index] - serviceCouponAllocations[index]
    )
    return calculateExclusiveTaxFromNet(netAfterCoupon, line.taxPercents)
  })
  lines.forEach((line, index) => {
    const netAfterCoupon = Math.max(
      0,
      serviceLineNetBeforeCoupon[index] - serviceCouponAllocations[index]
    )
    const taxCentsForLine = lineTaxByLine[index]
    line.lineTaxCents = taxCentsForLine
    line.lineTotalCents = netAfterCoupon + taxCentsForLine
  })

  const productTaxByLine = productLines.map((line, index) => {
    const netAfterCoupon = Math.max(
      0,
      productLineNetBeforeCoupon[index] - productCouponAllocations[index]
    )
    return calculateExclusiveTaxFromNet(netAfterCoupon, line.taxPercents)
  })
  productLines.forEach((line, index) => {
    const netAfterCoupon = Math.max(
      0,
      productLineNetBeforeCoupon[index] - productCouponAllocations[index]
    )
    const taxCentsForLine = productTaxByLine[index]
    line.lineTaxCents = taxCentsForLine
    line.lineTotalCents = netAfterCoupon + taxCentsForLine
  })

  const taxBreakdownMap = new Map<string, ResolvedOrderTax>()
  lines.forEach((line, index) => {
    const netAfterCoupon = Math.max(
      0,
      serviceLineNetBeforeCoupon[index] - serviceCouponAllocations[index]
    )
    line.taxPercents.forEach((tax) => {
      const taxCents = Math.max(
        0,
        Math.round((Math.max(0, netAfterCoupon) * Math.max(0, tax.percent)) / 100)
      )
      const current = taxBreakdownMap.get(tax.id)
      taxBreakdownMap.set(tax.id, {
        taxId: tax.id,
        name: tax.name,
        percent: tax.percent,
        taxCents: (current?.taxCents ?? 0) + taxCents,
      })
    })
  })
  productLines.forEach((line, index) => {
    const netAfterCoupon = Math.max(
      0,
      productLineNetBeforeCoupon[index] - productCouponAllocations[index]
    )
    line.taxPercents.forEach((tax) => {
      const taxCents = Math.max(
        0,
        Math.round((Math.max(0, netAfterCoupon) * Math.max(0, tax.percent)) / 100)
      )
      const current = taxBreakdownMap.get(tax.id)
      taxBreakdownMap.set(tax.id, {
        taxId: tax.id,
        name: tax.name,
        percent: tax.percent,
        taxCents: (current?.taxCents ?? 0) + taxCents,
      })
    })
  })
  const taxes = [...taxBreakdownMap.values()]
  const taxCents = taxes.reduce((sum, tax) => sum + tax.taxCents, 0)
  const totalCents =
    lines.reduce((sum, line) => sum + line.lineTotalCents, 0) +
    productLines.reduce((sum, line) => sum + line.lineTotalCents, 0)

  return {
    appointmentDate,
    appointmentStartAt,
    lines,
    productLines,
    coupons,
    totals: {
      subtotalCents,
      lineDiscountCents,
      couponDiscountCents,
      taxCents,
      totalCents,
    },
    taxes,
    customerId: customer.id,
    status: input.status ?? "DRAFT",
    customerNote: input.customerNote?.trim() || null,
    internalNote: input.internalNote?.trim() || null,
  }
}
