import { SalesOrderDetail } from "@/application/sales-orders/detail"
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <SalesOrderDetail id={(await params).id} /> }
