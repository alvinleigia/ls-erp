import { withCrmApi } from '@/application/crm/http'
import { readJson } from '@/platform/business-api'
type Context={params:Promise<{id:string}>}
export const GET=(request:Request,context:Context)=>withCrmApi(request,async s=>s.listPartyTaxIdentities({kind:'PERSON',id:(await context.params).id},Object.fromEntries(new URL(request.url).searchParams)))
export const POST=(request:Request,context:Context)=>withCrmApi(request,async s=>s.createPartyTaxIdentity({kind:'PERSON',id:(await context.params).id},await readJson(request)))
