"use client"

import { CrmSummarySection } from "@/modules/crm/components/crm-record-view"
import { CrmReadOnlyFields } from "@/modules/crm/components/crm-record-detail"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { formatDateForDisplay } from "@/lib/date"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { QuotationContent } from "../quotation-validation"
import type { QuotationSnapshot } from "../quotation-service"

// Saved documents display their immutable calculation, never a recalculated draft.
export function QuotationSummary({ value, snapshot, section, canEdit, name, archived }: {
  value: QuotationContent; snapshot?: QuotationSnapshot; section: "overview" | "pricing" | "payments" | "terms";
  canEdit: boolean; name?: string; archived?: boolean;
}) {
  const money = (amount: string) => formatDecimalCurrency(amount, value.currency, snapshot)
  const calculation = snapshot?.calculation
  if (section === "overview") return <>
    {name !== undefined && <CrmSummarySection title="Template configuration" canEdit={canEdit} fields={[{ label: "Template name", value: name }, { label: "Status", value: archived ? "Archived" : "Active" }]} />}
    <CrmSummarySection title="Document details" canEdit={canEdit} fields={[
      { label: "Title", value: value.title }, { label: "Supplier", value: value.supplierName },
      { label: "Currency", value: value.currency }, { label: "Website", value: value.website },
      { label: "Booking date", value: formatDateForDisplay(value.bookingDate, snapshot?.dateFormat) }, { label: "Valid until", value: formatDateForDisplay(value.validUntil, snapshot?.dateFormat) },
      { label: "Registration", value: value.registration }, { label: "Registration URL", value: value.registrationUrl },
      { label: "Logo", value: value.logoDataUrl ? "Included in document" : "None" },
    ]} />
    {snapshot && <CrmSection title="Customer and opportunity"><CrmReadOnlyFields fields={[
      { label: "Customer", value: snapshot.customer.name }, { label: "Email", value: snapshot.customer.email },
      { label: "Phone", value: snapshot.customer.phone }, { label: "Opportunity", value: snapshot.opportunity },
      ...snapshot.context,
    ]} /></CrmSection>}
    <CrmSummarySection title="Additional details" canEdit={canEdit} fields={value.details}>{!value.details.length && <p className="text-sm text-muted-foreground">No additional details.</p>}</CrmSummarySection>
    {calculation && <CrmSection title="Calculated summary"><CrmReadOnlyFields fields={[
      { label: "Base price", value: money(calculation.base) }, { label: "Included charges", value: money(calculation.included) },
      { label: "Discount", value: money(calculation.discount) }, { label: "Total consideration", value: money(calculation.consideration) },
      { label: "Extra charges", value: money(calculation.extras) }, { label: "Total known amount", value: money(calculation.totalKnown) },
    ]} />{calculation.hasPending && <p className="text-sm text-muted-foreground">Pending charges are excluded from the known total.</p>}</CrmSection>}
  </>
  if (section === "pricing") return <>
    <CrmSummarySection title="Price and discount" canEdit={canEdit} fields={[{ label: "Discount", value: money(value.discount) }]}>
      <DetailTable headings={["Description", "Quantity", "Unit", "Rate", ...(calculation ? ["Amount"] : [])]} rows={value.lines.map((line, index) => [line.description, line.quantity, line.unit, money(line.rate), ...(calculation ? [money(calculation.lines[index].amount)] : [])])} />
    </CrmSummarySection>
    <CrmSummarySection title="Charges" canEdit={canEdit} fields={[]}>
      <DetailTable headings={["Charge", "Group", "Basis", "Value", "Treatment", "Payment condition", ...(calculation ? ["Amount"] : [])]} rows={value.charges.map((charge, index) => [charge.label, charge.group, charge.kind === "PERCENT" ? charge.basis === "BASE" ? "Base price" : "Consideration" : charge.kind === "FIXED" ? "Fixed" : "Pending", charge.kind === "TBD" ? "Pending" : charge.kind === "PERCENT" ? `${charge.value}%` : money(charge.value), charge.included ? "Included" : "Extra", charge.due, ...(calculation ? [calculation.charges[index].amount === null ? "Pending" : money(calculation.charges[index].amount!)] : [])])} />
    </CrmSummarySection>
  </>
  if (section === "payments") return <CrmSummarySection title="Instalment schedule" canEdit={canEdit} fields={[]}>
    <p className="text-sm text-muted-foreground">Percentages apply to total consideration. Extra charges follow their own payment conditions.</p>
    <DetailTable headings={["Instalment", "Percentage", "Days from booking", "Note", ...(calculation ? ["Due date", "Amount"] : [])]} rows={value.instalments.map((item, index) => [item.label, `${item.percent}%`, String(item.days), item.note, ...(calculation ? [formatDateForDisplay(calculation.instalments[index].dueDate, snapshot?.dateFormat), money(calculation.instalments[index].amount)] : [])])} />
  </CrmSummarySection>
  return <>
    <CrmSummarySection title="Bank details" canEdit={canEdit} fields={Object.entries({ accountName: "Account name", accountNumber: "Account number", accountType: "Account type", bankName: "Bank", branch: "Branch", routingCode: "IFSC / routing code" }).map(([key, label]) => ({ label, value: value.bank[key as keyof typeof value.bank] }))} />
    <CrmSummarySection title="Terms and remarks" canEdit={canEdit} fields={[{ label: "Terms / remarks", value: value.terms }]} />
  </>
}

function DetailTable({ headings, rows }: { headings: string[]; rows: string[][] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">None added.</p>
  return <div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>{headings.map(heading => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t">{row.map((cell, column) => <td key={column} className="max-w-xs whitespace-pre-wrap break-words px-4 py-3">{cell || "—"}</td>)}</tr>)}</tbody></table></div>
}
