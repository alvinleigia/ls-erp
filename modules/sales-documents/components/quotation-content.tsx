"use client"
import type { QuotationContent } from "../quotation-validation"
import { quotationContentSchema } from "../quotation-validation"
import { calculateQuotation } from "../quotation-calculation"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { CrmSelect, CrmTextarea } from "@/modules/crm/components/crm-controls"
import { SearchableSelect } from "@/components/searchable-select"
import Image from "next/image"
import { formatDecimalCurrency } from "@/lib/formatting"
import { formatDateForDisplay } from "@/lib/date"
import type { AppSettingsPayload } from "@/types/scheduling"

export function QuotationContentFields({ value: v, onChange, disabled, template = false, paymentPlansEnabled = false, onError, settings, errors = {} }: { value: QuotationContent; onChange: (next: QuotationContent) => void; disabled?: boolean; template?: boolean; paymentPlansEnabled?: boolean; onError: (message: string) => void; settings?: Pick<AppSettingsPayload, "numberFormat" | "currencySymbolPlacement" | "dateFormat">; errors?: Record<string, string> }) {
  const set = <K extends keyof QuotationContent>(key: K, value: QuotationContent[K]) => onChange({ ...v, [key]: value })
  const field = (id: string, label: string, value: string, update: (value: string) => void, type = "text", max = 300) => <FormField key={id} id={id} label={label} error={errors[id]}><Input id={id} type={type} maxLength={max} value={value} onChange={e => update(e.target.value)} /></FormField>
  const select = (id: string, label: string, value: string, options: Record<string, string>, update: (value: string) => void) => <FormField id={id} label={label} error={errors[id]}><CrmSelect id={id} className="w-full" value={value} onValueChange={update}>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</CrmSelect></FormField>
  let summary: ReturnType<typeof calculateQuotation> | null = null, calculationError = ""
  try { summary = calculateQuotation(v) } catch (error) { calculationError = (error as Error).message.startsWith("[") ? "Complete the required document fields to calculate totals." : (error as Error).message }
  const amount = (value: string) => formatDecimalCurrency(value, v.currency, settings)
  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <CrmSection title="Document details" description="Branding and dates used on this document."><div className="grid gap-4 sm:grid-cols-2">
      {field("quote-title", "Document title", v.title, s => set("title", s), "text", 150)}
      <FormField id="quote-currency" label="Currency" error={errors["quote-currency"]}><SearchableSelect placeholder="Choose currency" id="quote-currency" value={v.currency} options={Intl.supportedValuesOf("currency").map(value => ({ value, label: value }))} onChange={s => set("currency", s)} disabled={disabled} /></FormField>
      {field("supplier", "Business / developer name", v.supplierName, s => set("supplierName", s), "text", 200)}
      {field("website", "Website (optional)", v.website, s => set("website", s), "url", 1000)}
      {!template && <>{field("booking-date", "Booking date (optional)", v.bookingDate, s => set("bookingDate", s), "date")}{field("valid-until", "Valid until (optional)", v.validUntil, s => set("validUntil", s), "date")}</>}
      {field("registration", "Registration reference / RERA (optional)", v.registration, s => set("registration", s))}
      {field("registration-url", "Registration link for QR code (optional)", v.registrationUrl, s => set("registrationUrl", s), "url", 1000)}
      <FormField id="quote-logo" label="Logo (PNG, optional)" error={errors["quote-logo"]}><Input id="quote-logo" type="file" accept="image/png" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return
        if (file.size > 290000) { onError("Use a PNG logo up to 290 KB."); return }
        const reader = new FileReader(); reader.onload = () => { const data = String(reader.result), result = quotationContentSchema.shape.logoDataUrl.safeParse(data); if (!result.success) onError(result.error.issues[0].message); else set("logoDataUrl", data) }; reader.readAsDataURL(file)
      }} />{v.logoDataUrl && <div className="flex items-center gap-3"><Image src={v.logoDataUrl} alt="Document logo" width={160} height={48} unoptimized className="mt-2 h-12 max-w-40 object-contain" /><Button type="button" variant="ghost" onClick={() => set("logoDataUrl", "")}>Remove logo</Button></div>}</FormField>
    </div></CrmSection>
    <CrmSection title="Additional details" description="For example, plot number, unit reference or facing.">
      {v.details.map((item, i) => <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto]">
        {field(`detail-label-${i}`, "Label", item.label, label => set("details", v.details.map((r, n) => n === i ? { ...r, label } : r)), "text", 100)}
        {field(`detail-value-${i}`, "Value", item.value, value => set("details", v.details.map((r, n) => n === i ? { ...r, value } : r)), "text", 500)}
        <Button type="button" variant="ghost" className="self-end" onClick={() => set("details", v.details.filter((_, n) => n !== i))}>Remove detail</Button>
      </div>)}
      <Button type="button" variant="outline" disabled={v.details.length >= 15} onClick={() => set("details", [...v.details, { label: "", value: "" }])}>Add detail</Button>
    </CrmSection>
    <CrmSection title="Price and discount" description="Quantity × rate. For a plot, enter the area as quantity and sq. m as the unit.">
      {v.lines.map((item, i) => <div key={i} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        {field(`line-description-${i}`, "Description", item.description, description => set("lines", v.lines.map((r, n) => n === i ? { ...r, description } : r)))}
        {field(`line-quantity-${i}`, "Quantity / area", item.quantity, quantity => set("lines", v.lines.map((r, n) => n === i ? { ...r, quantity } : r)))}
        {field(`line-unit-${i}`, "Unit", item.unit, unit => set("lines", v.lines.map((r, n) => n === i ? { ...r, unit } : r)), "text", 40)}
        {field(`line-rate-${i}`, "Rate per unit", item.rate, rate => set("lines", v.lines.map((r, n) => n === i ? { ...r, rate } : r)))}
        {v.lines.length > 1 && <Button type="button" variant="ghost" onClick={() => set("lines", v.lines.filter((_, n) => n !== i))}>Remove item</Button>}
      </div>)}
      <Button type="button" variant="outline" disabled={v.lines.length >= 30} onClick={() => set("lines", [...v.lines, { description: "", quantity: "1", unit: "", rate: "0" }])}>Add priced item</Button>
      <div className="max-w-xs">{field("discount", "Discount amount", v.discount, s => set("discount", s))}</div>
    </CrmSection>
    <CrmSection title="Charges" description="Include charges in consideration, or list them as extra with their own payment conditions. Pending amounts remain outside the total.">
      {v.charges.map((item, i) => {
        const edit = (patch: Partial<typeof item>) => set("charges", v.charges.map((r, n) => n === i ? { ...r, ...patch } : r))
        return <div key={i} className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
          {field(`charge-label-${i}`, "Charge name", item.label, label => edit({ label }), "text", 150)}
          {field(`charge-group-${i}`, "Subtotal group (optional)", item.group, group => edit({ group }), "text", 100)}
          {select(`charge-kind-${i}`, "Calculation", item.kind, { FIXED: "Fixed amount", PERCENT: "Percentage", TBD: "Amount to be confirmed" }, kind => edit({ kind: kind as typeof item.kind, ...(kind === "TBD" ? { included: false } : {}) }))}
          {item.kind !== "TBD" && field(`charge-value-${i}`, item.kind === "PERCENT" ? "Percentage" : "Amount", item.value, value => edit({ value }))}
          {item.kind === "PERCENT" && select(`charge-basis-${i}`, "Percentage based on", item.basis, item.included ? { BASE: "Base price" } : { BASE: "Base price", CONSIDERATION: "Total consideration" }, basis => edit({ basis: basis as typeof item.basis }))}
          {item.kind !== "TBD" && select(`charge-included-${i}`, "Treatment", item.included ? "included" : "extra", { included: "Included in consideration", extra: "Extra charge" }, treatment => edit({ included: treatment === "included", ...(treatment === "included" ? { basis: "BASE" } : {}) }))}
          {field(`charge-due-${i}`, "Due / conditions", item.due, due => edit({ due }), "text", 500)}
          <Button type="button" variant="ghost" onClick={() => set("charges", v.charges.filter((_, n) => n !== i))}>Remove charge</Button>
        </div>
      })}
      <Button type="button" variant="outline" disabled={v.charges.length >= 30} onClick={() => set("charges", [...v.charges, { label: "", group: "", kind: "FIXED", value: "0", basis: "BASE", included: false, due: "" }])}>Add charge</Button>
    </CrmSection>
    {(paymentPlansEnabled || v.instalments.length > 0) && <CrmSection title="Instalment schedule" description="Percentages apply to total consideration and must add up to 100%. Extra charges follow their separate conditions.">
      {v.instalments.map((item, i) => {
        const edit = (patch: Partial<typeof item>) => set("instalments", v.instalments.map((r, n) => n === i ? { ...r, ...patch } : r))
        return <div key={i} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          {field(`instalment-label-${i}`, "Milestone", item.label, label => edit({ label }), "text", 150)}
          {field(`instalment-percent-${i}`, "Percentage", item.percent, percent => edit({ percent }))}
          <FormField id={`instalment-days-${i}`} label="Days from booking" error={errors[`instalment-days-${i}`]}><Input id={`instalment-days-${i}`} type="number" min={0} max={36500} value={item.days} onChange={event => edit({ days: Number(event.target.value) })} /></FormField>
          {field(`instalment-note-${i}`, "Condition (optional)", item.note, note => edit({ note }))}
          {<Button type="button" variant="ghost" onClick={() => set("instalments", v.instalments.filter((_, n) => n !== i))}>Remove instalment</Button>}
        </div>
      })}
      <Button type="button" variant="outline" disabled={!paymentPlansEnabled || v.instalments.length >= 30} onClick={() => set("instalments", [...v.instalments, { label: "", percent: "0", days: 0, note: "" }])}>Add instalment</Button>
    </CrmSection>}
    {!template && <CrmSection title="Calculated summary">{summary ? <>
      <dl className="grid gap-4 sm:grid-cols-3">{[["Base price", summary.base], ["Included charges", summary.included], ["Discount", summary.discount], ["Total consideration", summary.consideration], ["Extra charges (known)", summary.extras], ["Total known amount", summary.totalKnown]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{amount(value)}</dd></div>)}</dl>
      {summary.hasPending && <p className="text-sm">Pending charges are additional and have not been included in the total.</p>}
      {summary.groups.map((group, i) => <p key={i} className="text-sm">{group.label} subtotal ({group.included ? "included" : "extra"}{group.hasPending ? ", known amounts" : ""}): <strong>{amount(group.amount)}</strong></p>)}
      <ul className="divide-y">{summary.instalments.map((item, i) => <li key={i} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span>{item.label} · {item.percent}% · {item.dueDate ? formatDateForDisplay(item.dueDate, settings?.dateFormat || "yyyy-MM-dd") : (item.days ? `${item.days} days from booking` : "On booking")}</span><strong>{amount(item.amount)}</strong></li>)}</ul>
    </> : <p role="status" className="text-sm text-muted-foreground">{calculationError}</p>}</CrmSection>}
    <CrmSection title="Bank details" description="Printed payment instructions. Saving a document does not collect or record any payment."><div className="grid gap-4 sm:grid-cols-2">{Object.entries({ accountName: "Account name", accountNumber: "Account number", accountType: "Account type", bankName: "Bank", branch: "Branch", routingCode: "IFSC / routing code" }).map(([key, label]) => field(`bank-${key}`, label, v.bank[key as keyof typeof v.bank], s => set("bank", { ...v.bank, [key]: s }), "text", 100))}</div></CrmSection>
    <CrmSection title="Terms and remarks"><FormField id="quote-terms" label="Terms / remarks" error={errors["quote-terms"]}><CrmTextarea id="quote-terms" value={v.terms} maxLength={10000} onChange={event => set("terms", event.target.value)} /></FormField></CrmSection>
  </fieldset>
}
