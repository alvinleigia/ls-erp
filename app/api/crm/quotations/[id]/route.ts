import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
import { z } from "zod"
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => {
 const raw = new URL(request.url).searchParams.get("revision")
 return service.getQuotation((await context.params).id, raw ? z.coerce.number().int().positive().parse(raw) : undefined)
})
export const PUT = (request: Request, context: Context) => withCrmApi(request, async service => {
 const row = await service.getQuotation((await context.params).id)
 return service.saveQuotation(row.opportunityId, await readJson(request), row.id)
})
