import { withCustomFieldApi } from "@/application/crm/custom-fields"
import { readJson } from "@/platform/business-api"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) { return withCustomFieldApi(request, async service => service.get((await context.params).id)) }
export function PATCH(request: Request, context: Context) { return withCustomFieldApi(request, async service => service.save(await readJson(request), (await context.params).id)) }
