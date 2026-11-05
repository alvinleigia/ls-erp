import type { PrismaClient } from '@prisma/client'
import { createReceiptDocumentService } from '@/modules/receivables/receipt-documents'
import { uploadReceiptDocumentPdf,removeUnusedPdf,archivedPdfUrl,readArchivedDocumentPdf } from '@/platform/storage/documents'
import type { DocumentIdentity,DocumentStorage } from '@/platform/documents/contracts'
const storage:DocumentStorage={upload:uploadReceiptDocumentPdf,remove:removeUnusedPdf,url:archivedPdfUrl,read:readArchivedDocumentPdf}
export const applicationPaymentDocuments=(db:PrismaClient,identity:DocumentIdentity,options?:{storage?:DocumentStorage;render?:Parameters<typeof createReceiptDocumentService>[3]})=>createReceiptDocumentService(db,identity,options?.storage??storage,options?.render)
