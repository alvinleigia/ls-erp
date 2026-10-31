import type { CustomerInvoice,Prisma } from '@prisma/client'
import type { InvoiceBillingInput } from '@/lib/validation'
import type { InvoiceTaxAllocation } from '@/platform/tax/invoice-allocation'

// Billed gross is separate from the accepted agreement and money received.
// Tax-aware portions reserve the accepted component balances; statutory document
// issuance remains separate from this internal billing allocation.
export type InvoiceBilling={format:1;request:InvoiceBillingInput;amount:string;allocations:{lineIndex:number;quantity:string;amount:string}[];tax?:InvoiceTaxAllocation}
export type BillingCapacity={taxAware?:boolean;currency:string;customer:string;orderReference:string;contractTotal:string;posted:string;credited:string;reserved:string;unbilled:string;available:string;lines:{lineIndex:number;description:string;unit:string;sourceQuantity:string;quantity:string;amount:string}[];milestones:{position:number;label:string;amount:string;remaining:string}[]}
export const invoiceBilling=(row:Pick<CustomerInvoice,'billing'>)=>row.billing as unknown as InvoiceBilling
export const invoiceAmount=(row:Pick<CustomerInvoice,'billing'>)=>invoiceBilling(row).amount
export async function billingCapacity(tx:Prisma.TransactionClient,tenantId:string,orderId:string,exceptId=''){
 const [r]=await tx.$queryRaw<{value:BillingCapacity}[]>`SELECT app.invoice_billing_capacity(${tenantId},${orderId},${exceptId}) value`
 return r.value
}
export async function allocateBilling(tx:Prisma.TransactionClient,tenantId:string,orderId:string,exceptId:string,input:InvoiceBillingInput){
 const [r]=await tx.$queryRaw<{value:InvoiceBilling}[]>`SELECT app.allocate_invoice_billing(${tenantId},${orderId},${exceptId},${JSON.stringify(input)}::jsonb) value`
 return r.value
}
