import { taxQuery,withTaxConfigurationApi } from '@/platform/tax/http'
import { readJson } from '@/platform/business-api'
import { documentPageSchema } from '@/platform/documents/validation'
type Context={params:Promise<{id:string}>}
export const GET=(r:Request,c:Context)=>withTaxConfigurationApi(r,async s=>s.getRegistration((await c.params).id,documentPageSchema.parse(taxQuery(r)).page))
export const PUT=(r:Request,c:Context)=>withTaxConfigurationApi(r,async s=>s.updateRegistration((await c.params).id,await readJson(r)))
