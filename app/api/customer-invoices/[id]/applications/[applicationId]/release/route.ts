import { withCustomerInvoicesApi } from '@/application/customer-invoices/http'
import { readJson } from '@/platform/business-api'
export const POST=(r:Request,c:{params:Promise<{id:string;applicationId:string}>})=>withCustomerInvoicesApi(r,async s=>{const p=await c.params;return s.release(p.id,p.applicationId,await readJson(r))})
