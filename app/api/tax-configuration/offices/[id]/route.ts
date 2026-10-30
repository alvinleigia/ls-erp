import { withTaxConfigurationApi } from '@/platform/tax/http'
import { readJson } from '@/platform/business-api'
type Context={params:Promise<{id:string}>}
export const GET=(r:Request,c:Context)=>withTaxConfigurationApi(r,async s=>s.office((await c.params).id))
export const PUT=(r:Request,c:Context)=>withTaxConfigurationApi(r,async s=>s.mapOffice((await c.params).id,await readJson(r)))
