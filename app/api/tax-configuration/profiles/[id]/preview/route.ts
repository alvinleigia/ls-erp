import { withTaxConfigurationApi } from '@/platform/tax/http'
import { readJson } from '@/platform/business-api'
export const POST=(r:Request,c:{params:Promise<{id:string}>})=>withTaxConfigurationApi(r,async s=>s.previewProfile((await c.params).id,await readJson(r)))
