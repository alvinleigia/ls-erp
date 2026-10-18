import { withCatalogApi } from "@/application/catalog/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCatalogApi(request, async service => service.get((await context.params).id))
export const PUT = (request: Request, context: Context) => withCatalogApi(request, async service => service.save(await readJson(request), (await context.params).id))
