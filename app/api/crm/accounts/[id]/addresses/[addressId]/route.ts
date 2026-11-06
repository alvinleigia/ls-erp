import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
type Context = { params: Promise<{ id: string; addressId: string }> }
export const GET = (request: Request, context: Context) => withCrmApi(request, async service => { const p = await context.params; return service.getPartyAddress({ kind: "BUSINESS", id: p.id }, p.addressId) })
export const PATCH = (request: Request, context: Context) => withCrmApi(request, async service => { const p = await context.params; return service.updatePartyAddress({ kind: "BUSINESS", id: p.id }, p.addressId, await readJson(request)) })
