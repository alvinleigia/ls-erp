import { quotationContentSchema } from "./quotation-validation"

// Exact fixed-point arithmetic; no binary floating-point totals or percentages.
const scale = BigInt(10000)
function scaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * scale + BigInt(fraction.padEnd(4, "0")) }
function rounded(n: bigint, d: bigint) { return (n + d / BigInt(2)) / d }
export function calculateQuotation(input: unknown) {
  const data = quotationContentSchema.parse(input)
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: data.currency }).resolvedOptions().maximumFractionDigits ?? 2
  const factor = BigInt(10) ** BigInt(digits)
  const money = (amount: bigint) => {
    if (amount < BigInt(0) || amount > BigInt(999999999999) * factor) throw new Error("Document total is outside the supported range.")
    return digits ? `${amount / factor}.${String(amount % factor).padStart(digits, "0")}` : String(amount)
  }
  const amounts = data.lines.map(line => rounded(scaled(line.quantity) * scaled(line.rate) * factor, scale * scale))
  const base = amounts.reduce((sum, value) => sum + value, BigInt(0))
  const chargeValue = (charge: typeof data.charges[number], consideration: bigint) => charge.kind === "TBD" ? BigInt(0) : charge.kind === "FIXED" ? rounded(scaled(charge.value) * factor, scale) : rounded((charge.basis === "BASE" ? base : consideration) * scaled(charge.value), BigInt(100) * scale)
  const included = data.charges.reduce((sum, charge) => sum + (charge.included ? chargeValue(charge, base) : BigInt(0)), BigInt(0))
  const discount = rounded(scaled(data.discount) * factor, scale)
  const consideration = base + included - discount
  if (consideration <= BigInt(0)) throw new Error("Total consideration must be greater than zero after discount.")
  const charges = data.charges.map(charge => ({ ...charge, amount: charge.kind === "TBD" ? null : money(chargeValue(charge, consideration)) }))
  const extras = data.charges.reduce((sum, charge) => sum + (!charge.included ? chargeValue(charge, consideration) : BigInt(0)), BigInt(0))
  const grouped = new Map<string, { label: string; included: boolean; amount: bigint; hasPending: boolean }>()
  for (const charge of data.charges) if (charge.group) {
    const key = `${charge.included}:${charge.group}`, previous = grouped.get(key)
    grouped.set(key, { label: charge.group, included: charge.included, amount: (previous?.amount || BigInt(0)) + chargeValue(charge, consideration), hasPending: !!previous?.hasPending || charge.kind === "TBD" })
  }
  const groups = [...grouped.values()].map(group => ({ ...group, amount: money(group.amount) }))
  if (data.instalments.reduce((sum, item) => sum + scaled(item.percent), BigInt(0)) !== BigInt(100) * scale) throw new Error("Instalment percentages must total exactly 100%.")
  // Round cumulative allocations so every amount is non-negative and reconciles.
  let cumulative = BigInt(0), allocated = BigInt(0)
  const instalments = data.instalments.map(item => {
    cumulative += scaled(item.percent)
    const next = rounded(consideration * cumulative, BigInt(100) * scale), amount = next - allocated
    allocated = next
    let dueDate = ""
    if (data.bookingDate) { const due = new Date(`${data.bookingDate}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + item.days); if (due.getUTCFullYear() > 9999) throw new Error("Instalment due date is outside the supported date range."); dueDate = due.toISOString().slice(0, 10) }
    return { ...item, amount: money(amount), dueDate }
  })
  return { base: money(base), included: money(included), discount: money(discount), consideration: money(consideration), extras: money(extras), totalKnown: money(consideration + extras), hasPending: data.charges.some(charge => charge.kind === "TBD"), lines: data.lines.map((line, index) => ({ ...line, amount: money(amounts[index]) })), charges, groups, instalments }
}
export type QuotationCalculation = ReturnType<typeof calculateQuotation>
