"use client"
import { OrderDetail } from "@/modules/sales-orders/components/detail"
import { QuotationSummary } from "@/modules/sales-documents/components/quotation-summary"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { useBusinessModules } from "@/platform/module-provider"
import { OrderReservations } from "@/modules/catalog/components/order-reservations"
import { OrderReceivables } from "@/modules/receivables/components/order-receivables"
import { CollectionFollowUps } from "@/application/receivables/follow-ups"
import { OrderDocuments } from "@/modules/sales-orders/components/documents"
import { OrderInvoices } from "@/modules/customer-invoices/components"
import { OrderTaxAgreement } from "@/modules/sales-orders/components/tax-agreement"
import { ParticipantVerificationSummary } from "@/platform/verification/source-controls"
export function SalesOrderDetail({ id }: { id: string }) {
  const modules = useBusinessModules()
  return <OrderDetail id={id} renderPanels={(value, version) => {
    const snapshot = value as QuotationSnapshot
    const summary = (section: "overview" | "pricing" | "payments" | "terms", overviewSections?: ("document" | "customers" | "context" | "additional" | "totals")[]) => <QuotationSummary value={snapshot.content} snapshot={snapshot} section={section} overviewSections={overviewSections} canEdit={false} />
    return [
      { value: "overview", label: "Overview", content: <>
        {summary("overview", ["totals"])}
        {summary("pricing")}
        <OrderTaxAgreement key={version} orderId={id}/>
        <details className="rounded-xl border bg-card p-4 sm:p-5"><summary className="cursor-pointer font-medium">Quotation details and sales context</summary><div className="mt-4 space-y-5">{summary("overview", ["document", "context", ...(snapshot.content.details.length ? ["additional" as const] : [])])}</div></details>
        <details className="rounded-xl border bg-card p-4 sm:p-5"><summary className="cursor-pointer font-medium">Bank instructions and terms</summary><div className="mt-4 space-y-5">{summary("terms")}</div></details>
      </> },
      { value: "customers", label: "Customers", content: summary("overview", snapshot.participants ? ["customers"] : ["context"]) },
      ...(modules.enabled("customerVerification") && modules.can("verificationSummaries.read") ? [{ value: "verification", label: "Verification", permission: "verificationSummaries.read" as const, content: <ParticipantVerificationSummary kind="ORDER" id={id} version={version} /> }] : []),
      ...(modules.can("orderDocuments.read") ? [{ value: "documents", label: "Documents", permission: "orderDocuments.read" as const, content: <OrderDocuments key={version} orderId={id}/> }] : []),
      ...(modules.enabled("catalog") && modules.can("catalogItems.read") && modules.can("unitReservations.read") && snapshot.items?.some(item => item.kind === "UNIT") ? [{ value: "units", label: "Units", permission: ["catalogItems.read", "unitReservations.read"] as const, content: <OrderReservations key={version} orderId={id}/> }] : []),
      { value: "payments", label: "Payments", content: <div key={version} className="space-y-6">
        {modules.enabled("receivables") && modules.can("receivables.read") && <OrderReceivables orderId={id} renderFollowUps={modules.enabled("crm") && modules.can("activities.read") ? version => <CollectionFollowUps key={version} orderId={id} /> : undefined} />}
        {modules.enabled("invoicing") && modules.can("customerInvoices.read") && <OrderInvoices orderId={id}/>}
        {snapshot.content.instalments.length ? <details className="rounded-xl border bg-card p-4 sm:p-5"><summary className="cursor-pointer font-medium">Agreed instalment schedule</summary><div className="mt-4">{summary("payments")}</div></details> : <p className="text-sm text-muted-foreground">No instalment schedule saved on this agreement.</p>}
      </div> },
    ]
  }} />
}
