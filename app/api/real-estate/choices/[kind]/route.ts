import { withRealEstateApi } from "@/modules/real-estate/http"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ kind: string }> }
export function GET(request: Request, context: Context) {
  return withRealEstateApi(request, async service => {
    const { kind } = await context.params
    return kind === "defaults" ? service.choiceDefaults() : service.listChoices(kind, Object.fromEntries(new URL(request.url).searchParams))
  })
}
export function POST(request: Request, context: Context) {
  return withRealEstateApi(request, async service => service.saveChoice((await context.params).kind, await readJson(request)), 201)
}
