import { withStatutoryInvoicesApi } from '@/application/customer-invoices/http'
import { documentPageSchema } from '@/platform/documents/validation'
export const GET=(r:Request,c:{params:Promise<{id:string}>})=>withStatutoryInvoicesApi(r,async s=>s.get((await c.params).id,documentPageSchema.parse(Object.fromEntries(new URL(r.url).searchParams)).page))
