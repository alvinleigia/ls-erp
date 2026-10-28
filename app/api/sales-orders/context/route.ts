import { withSalesOrdersApi } from "@/application/sales-orders/http"
export const GET = (request: Request) => withSalesOrdersApi(request, service => service.prepareCreate(Object.fromEntries(new URL(request.url).searchParams)))
