import { CustomerInvoiceDetail } from '@/modules/customer-invoices/components'
export default async function Page({params}:{params:Promise<{id:string}>}){return <CustomerInvoiceDetail id={(await params).id}/>}
