import { withRealEstateApi } from "@/modules/real-estate/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) { return withRealEstateApi(request, async service => service.listMembers((await context.params).id, Object.fromEntries(new URL(request.url).searchParams))) }
export function PATCH(request: Request, context: Context) { return withRealEstateApi(request, async service => service.changeMember((await context.params).id, await readJson(request))) }
