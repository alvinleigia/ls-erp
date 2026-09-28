import { withRealEstateApi } from "@/modules/real-estate/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) { return withRealEstateApi(request, async service => service.getProject((await context.params).id)) }
export function PATCH(request: Request, context: Context) { return withRealEstateApi(request, async service => service.updateProject((await context.params).id, await readJson(request))) }
