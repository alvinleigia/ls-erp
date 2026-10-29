import { withCustomerInvoicesApi } from '@/application/customer-invoices/http'
import { readJson } from '@/platform/business-api'
import { documentPageSchema } from '@/platform/documents/validation'
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>s.list((await c.params).id,documentPageSchema.parse(Object.fromEntries(new URL(r.url).searchParams)).page))
export const POST=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>s.create((await c.params).id,await readJson(r)))
