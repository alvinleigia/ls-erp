import { taxQuery,withTaxConfigurationApi } from '@/platform/tax/http'
import { readJson } from '@/platform/business-api'
export const GET=(r:Request)=>withTaxConfigurationApi(r,s=>s.listRegistrations(taxQuery(r)))
export const POST=(r:Request)=>withTaxConfigurationApi(r,async s=>s.createRegistration(await readJson(r)),201)
