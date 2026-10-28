"use client"
import { OrderDetail } from "@/modules/sales-orders/components/detail"
import { QuotationSummary } from "@/modules/sales-documents/components/quotation-summary"
import type { QuotationSnapshot } from "@/modules/sales-documents/quotation-service"
import { useBusinessModules } from "@/platform/module-provider"
import { OrderReservations } from "@/modules/catalog/components/order-reservations"
import { OrderReceivables } from "@/modules/receivables/components/order-receivables"
import { CollectionFollowUps } from "@/application/receivables/follow-ups"
import { OrderDocuments } from "@/modules/sales-orders/components/documents"
export function SalesOrderDetail({ id }: { id: string }) {
  const modules = useBusinessModules()
  return <OrderDetail id={id} renderRelated={version => <div key={version} className="space-y-6">
    {modules.can("orderDocuments.read")&&<OrderDocuments orderId={id}/>}
    {modules.enabled("catalog") && modules.can("catalogItems.read") && modules.can("unitReservations.read") && <OrderReservations orderId={id} />}
    {modules.enabled("receivables") && modules.can("receivables.read") && <OrderReceivables orderId={id} renderFollowUps={modules.enabled("crm") && modules.can("activities.read") ? version => <CollectionFollowUps key={version} orderId={id} /> : undefined} />}
  </div>} renderSnapshot={value => {
    const snapshot = value as QuotationSnapshot
    return <>{(["overview", "pricing", ...(snapshot.content.instalments.length ? ["payments" as const] : []), "terms"] as const).map(section => <QuotationSummary key={section} value={snapshot.content} snapshot={snapshot} section={section} canEdit={false} />)}</>
  }} />
}
