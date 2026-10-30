import { withQuotationTaxInputs } from '@/application/tax-inputs/http'
import { readJson } from '@/platform/business-api'
type Context={params:Promise<{id:string}>}
export const GET=(r:Request,c:Context)=>withQuotationTaxInputs(r,async s=>s.pricing((await c.params).id,Object.fromEntries(new URL(r.url).searchParams)))
export const POST=(r:Request,c:Context)=>withQuotationTaxInputs(r,async s=>s.approvePricing((await c.params).id,await readJson(r)))
