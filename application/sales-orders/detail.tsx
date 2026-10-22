"use client"
import { OrderDetail } from "@/modules/sales-orders/components/detail"
import { QuotationSummary } from "@/modules/sales-documents/components/quotation-summary"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { useBusinessModules } from "@/platform/module-provider"
import { OrderReservations } from "@/modules/catalog/components/order-reservations"
export function SalesOrderDetail({ id }: { id: string }) {
  const modules = useBusinessModules()
  return <OrderDetail id={id} renderRelated={version => modules.enabled("catalog") && modules.can("catalogItems.read") && modules.can("unitReservations.read") ? <OrderReservations key={version} orderId={id} /> : null} renderSnapshot={value => {
    const snapshot = value as QuotationSnapshot
    return <>{(["overview", "pricing", ...(snapshot.content.instalments.length ? ["payments" as const] : []), "terms"] as const).map(section => <QuotationSummary key={section} value={snapshot.content} snapshot={snapshot} section={section} canEdit={false} />)}</>
  }} />
}
