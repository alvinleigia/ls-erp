import { withCustomerInvoicesApi } from '@/application/customer-invoices/http'
import { readJson } from '@/platform/business-api'
export const POST=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>s.apply((await c.params).id,await readJson(r)))
