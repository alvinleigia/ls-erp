import { taxQuery,withTaxConfigurationApi } from '@/platform/tax/http'
import { documentPageSchema } from '@/platform/documents/validation'
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withTaxConfigurationApi(r,async s=>s.getProfile((await c.params).id,documentPageSchema.parse(taxQuery(r)).page))
