import { withSalesOrdersApi } from "@/application/sales-orders/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withSalesOrdersApi(request, async service => service.get((await context.params).id))
export const PATCH = (request: Request, context: Context) => withSalesOrdersApi(request, async service => service.transition((await context.params).id, await readJson(request)))
