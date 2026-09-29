import { withRealEstateApi } from "@/modules/real-estate/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ kind: string; id: string }> }
export function GET(request: Request, context: Context) {
  return withRealEstateApi(request, async service => { const { kind, id } = await context.params; return service.getChoice(kind, id) })
}
export function PATCH(request: Request, context: Context) {
  return withRealEstateApi(request, async service => { const { kind, id } = await context.params; return service.saveChoice(kind, await readJson(request), id) })
}
