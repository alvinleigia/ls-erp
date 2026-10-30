import { taxQuery,withTaxConfigurationApi } from '@/platform/tax/http'
export const GET=(r:Request)=>withTaxConfigurationApi(r,s=>s.listOffices(taxQuery(r)))
