import { taxQuery,withTaxConfigurationApi } from '@/platform/tax/http'
import { readJson } from '@/platform/business-api'
export const GET=(r:Request)=>withTaxConfigurationApi(r,s=>s.listProfiles(taxQuery(r)))
export const POST=(r:Request)=>withTaxConfigurationApi(r,async s=>s.publishProfile(await readJson(r)))
