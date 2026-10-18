import { prisma } from "@/lib/prisma"
import type { AppointmentOrderCreateInput } from "@/lib/validation"
import type { BusinessActor } from "@/platform/policy"
import type { AppointmentOrderPricingPreview } from "@/types/appointments"
import { prepareOrderEdit, readOrder } from "./order-mutations"
import { resolveOrderData } from "./order-resolution"

// Read-only pricing. Saving always validates again inside the write transaction.
export async function previewOrder(actor: BusinessActor, input: AppointmentOrderCreateInput, orderId?: string): Promise<AppointmentOrderPricingPreview> {
  const saved = orderId ? await readOrder(prisma, actor.tenantId, orderId) : null
  if (saved) {
    const settings = await prisma.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } })
    const prepared = prepareOrderEdit(saved, input, settings?.timeZone ?? "UTC")
    input = prepared.input
    if (!prepared.financialChanged) return {
      source: "saved",
      totals: { subtotalCents: saved.subtotalCents, lineDiscountCents: saved.lineDiscountCents,
        couponDiscountCents: saved.couponDiscountCents, taxCents: saved.taxCents, totalCents: saved.totalCents },
      lines: saved.lines.map(line => ({ taxCents: line.lineTaxCents, totalCents: line.lineTotalCents })),
      productLines: saved.productLines.map(line => ({ taxCents: line.lineTaxCents, totalCents: line.lineTotalCents })),
      couponHints: saved.coupons.map(coupon => ({ code: coupon.code, eligible: true, discountCents: coupon.discountCents })),
    }
  }
  const resolved = await resolveOrderData(input, { actor, tenantId: actor.tenantId, existingOrderId: saved?.id, savedLines: saved?.lines })
  return { source: "current", totals: resolved.totals, couponHints: resolved.couponHints,
    lines: resolved.lines.map(line => ({ taxCents: line.lineTaxCents, totalCents: line.lineTotalCents })),
    productLines: resolved.productLines.map(line => ({ taxCents: line.lineTaxCents, totalCents: line.lineTotalCents })) }
}
