import { withCustomerInvoicesApi } from '@/application/customer-invoices/http'
import { documentCatalogSchema } from '@/platform/documents/validation'
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withCustomerInvoicesApi(r,async s=>s.choices((await c.params).id,documentCatalogSchema.parse(Object.fromEntries(new URL(r.url).searchParams))))
