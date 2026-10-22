"use client"
import { OrderDetail } from "@/modules/sales-orders/components/detail"
import { QuotationSummary } from "@/modules/sales-documents/components/quotation-summary"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
export function SalesOrderDetail({ id }: { id: string }) {
  return <OrderDetail id={id} renderSnapshot={value => {
    const snapshot = value as QuotationSnapshot
    return <>{(["overview", "pricing", ...(snapshot.content.instalments.length ? ["payments" as const] : []), "terms"] as const).map(section => <QuotationSummary key={section} value={snapshot.content} snapshot={snapshot} section={section} canEdit={false} />)}</>
  }} />
}
