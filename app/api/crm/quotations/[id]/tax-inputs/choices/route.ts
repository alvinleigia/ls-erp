import { withQuotationTaxInputs } from '@/application/tax-inputs/http'
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withQuotationTaxInputs(r,async s=>s.choices((await c.params).id,Object.fromEntries(new URL(r.url).searchParams)))
