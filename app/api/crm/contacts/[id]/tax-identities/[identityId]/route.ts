import { withCrmApi } from '@/application/crm/http'
import { readJson } from '@/platform/business-api'
type Context={params:Promise<{id:string;identityId:string}>}
export const GET=(request:Request,context:Context)=>withCrmApi(request,async s=>{const p=await context.params;return s.getPartyTaxIdentity({kind:'PERSON',id:p.id},p.identityId,Number(new URL(request.url).searchParams.get('page')||1))})
export const PATCH=(request:Request,context:Context)=>withCrmApi(request,async s=>{const p=await context.params;return s.updatePartyTaxIdentity({kind:'PERSON',id:p.id},p.identityId,await readJson(request))})
