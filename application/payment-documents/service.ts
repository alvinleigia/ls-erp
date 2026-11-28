import type { PrismaClient } from '@prisma/client'
import { createReceiptDocumentService } from '@/modules/receivables/receipt-documents'
import { uploadReceiptDocumentPdf,removeUnusedPdf,archivedPdfUrl,readArchivedDocumentPdf } from '@/platform/storage/documents'
import type { DocumentIdentity,DocumentStorage } from '@/platform/documents/contracts'
import { createPaymentReceiptProvider } from '@/modules/receivables/receipt-template'
import { realEstateReceiptDetails } from '@/modules/real-estate/receipt-details'
import { quotationReceivablePlan } from '@/application/receivables/plan'
const baseProvider=createPaymentReceiptProvider(realEstateReceiptDetails)
export const applicationPaymentReceiptProvider:typeof baseProvider={...baseProvider,async blocks(tx,actor,c){
  const result=await baseProvider.blocks(tx,actor,c),pending=quotationReceivablePlan(c.order.snapshot).pending??[]
  if(!pending.length)return result
  const confirmed=await tx.orderReceivableCharge.findMany({where:{tenantId:actor.tenantId,orderId:c.order.id},select:{sourceKey:true}})
  const remaining=pending.filter(row=>!confirmed.some(saved=>saved.sourceKey===row.sourceKey))
  const notice=remaining.length?`Unconfirmed extras excluded from these balances: ${remaining.map(row=>row.label).join('; ')}. These amounts are still to be agreed.`:'These balances include separately confirmed extras. The original agreement and instalments remain unchanged.'
  result.blocks.find(block=>block.key==='payment')?.paragraphs?.push(notice)
  return {...result,values:{...result.values,'payment.notice':`${result.values?.['payment.notice']??'This receipt reflects the posted payment at issuance. Check current payment status. This is not a tax invoice.'} ${notice}`}}
}}
const storage:DocumentStorage={upload:uploadReceiptDocumentPdf,remove:removeUnusedPdf,url:archivedPdfUrl,read:readArchivedDocumentPdf}
export const applicationPaymentDocuments=(db:PrismaClient,identity:DocumentIdentity,options?:{storage?:DocumentStorage;render?:Parameters<typeof createReceiptDocumentService>[3]})=>createReceiptDocumentService(db,identity,options?.storage??storage,options?.render,applicationPaymentReceiptProvider)
