import { withCustomerInvoicesApi } from '@/application/customer-invoices/http'
import { readJson } from '@/platform/business-api'
import { z } from 'zod'
const query=z.object({applicationPage:z.coerce.number().int().min(1).max(1000000).default(1),historyPage:z.coerce.number().int().min(1).max(1000000).default(1)}).strict()
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>{const q=query.parse(Object.fromEntries(new URL(r.url).searchParams));return s.get((await c.params).id,q.applicationPage,q.historyPage)})
export const PUT=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>s.edit((await c.params).id,await readJson(r)))
export const PATCH=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>s.transition((await c.params).id,await readJson(r)))
