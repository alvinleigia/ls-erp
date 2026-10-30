import { percentageMinor, type DecimalInput } from "@/platform/tax/arithmetic"
import type { DiscountType } from "@prisma/client"

// Stored subtotals mix quoted inclusive/exclusive prices. Derive a net display
// subtotal from saved totals without repricing or changing historical records.
export const subtotalAfterLineDiscounts = (totals: { totalCents: number; taxCents: number; couponDiscountCents: number }) =>
  totals.totalCents - totals.taxCents + totals.couponDiscountCents

export type PriceableOrderLine = {
  quantity: number
  unitPriceCents: number
  discountType: DiscountType
  discountValue: number
}

export type CouponRule = {
  code: string
  discountType: DiscountType
  discountValue: number
  appliesTo?: "ORDER" | "SERVICE_LINES" | "PRODUCT_LINES"
  allowedServiceIds?: string[]
  allowedCategoryIds?: string[]
  allowedProductIds?: string[]
  minSubtotalCents?: number
  stackingMode?: "STACKABLE" | "EXCLUSIVE"
  maxUsesPerCustomer?: number
  usedByCustomerCount?: number
}

export type CalculatedCoupon = CouponRule & {
  discountCents: number
}

export type TaxRule = {
  id: string
  name: string
  percent: DecimalInput
}

export type CalculatedTax = TaxRule & {
  taxCents: number
}

export const calculateDiscountCents = (
  discountType: DiscountType,
  discountValue: number,
  lineSubtotalCents: number
) => {
  if (discountType === "NONE" || discountValue <= 0) return 0
  if (discountType === "AMOUNT") {
    return Math.min(lineSubtotalCents, Math.round(discountValue * 100))
  }
  const percentDiscount = percentageMinor(lineSubtotalCents,discountValue)
  return Math.min(lineSubtotalCents, percentDiscount)
}

export const calculateLineAmounts = (line: PriceableOrderLine) => {
  const lineSubtotalCents = Math.max(0, line.quantity) * Math.max(0, line.unitPriceCents)
  const lineDiscountCents = calculateDiscountCents(
    line.discountType,
    Math.max(0, line.discountValue),
    lineSubtotalCents
  )
  const lineTotalCents = Math.max(0, lineSubtotalCents - lineDiscountCents)
  return { lineSubtotalCents, lineDiscountCents, lineTotalCents }
}

export const resolveCouponRules = (rawCodes: string[]) => {
  const deduped = new Set(
    rawCodes.map((code) => code.trim().toUpperCase()).filter(Boolean)
  )
  return [...deduped]
}

export const pickActiveCouponRules = (
  normalizedCodes: string[],
  rules: CouponRule[]
) => {
  const ruleMap = new Map(rules.map((rule) => [rule.code.trim().toUpperCase(), rule]))
  return normalizedCodes
    .map((code) => ruleMap.get(code))
    .filter((rule): rule is CouponRule => Boolean(rule))
}

export const calculateCouponDiscounts = (
  subtotalAfterLineDiscountCents: number,
  couponRules: CouponRule[]
) => {
  let runningBase = Math.max(0, subtotalAfterLineDiscountCents)
  const coupons: CalculatedCoupon[] = []

  couponRules.forEach((rule) => {
    const discountCents = calculateDiscountCents(
      rule.discountType,
      rule.discountValue,
      runningBase
    )
    runningBase = Math.max(0, runningBase - discountCents)
    coupons.push({ ...rule, discountCents })
  })

  return coupons
}

export const calculateTaxBreakdown = (
  taxableAmountCents: number,
  taxRules: TaxRule[]
) =>
  taxRules.map((tax) => ({
    ...tax,
    taxCents: Math.max(
      0,
      percentageMinor(Math.max(0,taxableAmountCents),tax.percent)
    ),
  }))
