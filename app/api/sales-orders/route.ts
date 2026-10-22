import { withSalesOrdersApi } from "@/application/sales-orders/http"
import { readJson } from "@/platform/business-api"
export const GET = (request: Request) => withSalesOrdersApi(request, service => service.list(Object.fromEntries(new URL(request.url).searchParams)))
export const POST = (request: Request) => withSalesOrdersApi(request, async service => service.create(await readJson(request)))
