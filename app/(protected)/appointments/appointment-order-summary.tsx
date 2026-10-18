"use client"
import { subtotalAfterLineDiscounts } from "@/modules/appointments/order-pricing"
import { wallTime } from "@/lib/business-time"

import { Section } from "@/components/erp/section"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatCurrencyFromCents, formatTimeFrom24h } from "@/lib/formatting"
import type { AppointmentOrderRow } from "@/types/appointments"
import type { AppSettingsPayload } from "@/types/scheduling"

export function AppointmentOrderSummary({ order, settings }: { order: AppointmentOrderRow; settings: AppSettingsPayload }) {
  const formatTimeFromDate = (value: Date, format: typeof settings) => formatTimeFrom24h(wallTime(value, format.timeZone ?? "UTC").slice(11, 16), format)
  const { formatDate } = useDateFormatter()
  const money = (value: number) => formatCurrencyFromCents(value, settings)
  return <>
    <Section title="Booking details"><ReadOnlyFields fields={[
      { label: "Customer", value: order.customer?.name || order.customer?.email },
      { label: "Date", value: formatDate(order.appointmentDate) },
      { label: "Start time", value: formatTimeFromDate(new Date(order.appointmentStartAt), settings) },
      { label: "Status", value: order.status },
      { label: "Customer note", value: order.customerNote },
      { label: "Internal note", value: order.internalNote },
    ]} /></Section>
    <Section title="Service items">{order.lines.map(line => <div key={line.id} className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">{line.service?.name || "Service"}</h3><ReadOnlyFields fields={[
        { label: "Attendant", value: line.staffProfile?.user?.name || line.staffProfile?.user?.email },
        { label: "Scheduled start", value: `${formatDate(wallTime(line.startAt, settings.timeZone ?? "UTC").slice(0, 10))} ${formatTimeFromDate(new Date(line.startAt), settings)}` },
        { label: "Scheduled end", value: `${formatDate(wallTime(line.endAt, settings.timeZone ?? "UTC").slice(0, 10))} ${formatTimeFromDate(new Date(line.endAt), settings)}` },
        { label: "Quantity", value: line.quantity }, { label: "Duration", value: `${line.durationMinutes} minutes` },
        { label: "Unit price", value: money(line.unitPriceCents) }, { label: "Discount", value: money(line.lineDiscountCents) },
        { label: "Tax", value: money(line.lineTaxCents) }, { label: "Total", value: money(line.lineTotalCents) }, { label: "Note", value: line.note },
      ]} />
    </div>)}</Section>
    {!!order.productLines?.length && <Section title="Product items">{order.productLines.map(line => <div key={line.id} className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">{line.product?.name || "Product"}</h3><ReadOnlyFields fields={[
      { label: "Quantity", value: line.quantity }, { label: "Unit price", value: money(line.unitPriceCents) },
      { label: "Discount", value: money(line.lineDiscountCents) }, { label: "Tax", value: money(line.lineTaxCents) },
      { label: "Total", value: money(line.lineTotalCents) }, { label: "Note", value: line.note },
    ]} /></div>)}</Section>}
    <Section title="Totals"><ReadOnlyFields fields={[
      { label: "Subtotal after line discounts (excl. tax)", value: money(subtotalAfterLineDiscounts(order)) }, { label: "Line discounts included", value: money(order.lineDiscountCents) },
      { label: "Coupon discount", value: money(-order.couponDiscountCents) }, { label: "Tax", value: money(order.taxCents) },
      { label: "Total", value: money(order.totalCents) }, { label: "Coupons", value: order.coupons.map(coupon => coupon.code).join(", ") || "None" },
    ]} /></Section>
  </>
}
