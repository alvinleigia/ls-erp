import type { PrismaClient } from '@prisma/client'
import type { DocumentIdentity,DocumentStorage } from '@/platform/documents/contracts'
import { createCustomerInvoiceService } from '@/modules/customer-invoices/service'
import { createInvoiceDocumentService } from '@/modules/customer-invoices/documents'
import { uploadInvoiceDocumentPdf,removeUnusedPdf,archivedPdfUrl } from '@/platform/storage/documents'
const storage:DocumentStorage={upload:uploadInvoiceDocumentPdf,remove:removeUnusedPdf,url:archivedPdfUrl}
export const applicationCustomerInvoices=(db:PrismaClient,identity:DocumentIdentity)=>createCustomerInvoiceService(db,identity)
export const applicationInvoiceDocuments=(db:PrismaClient,identity:DocumentIdentity,options?:{storage?:DocumentStorage;render?:Parameters<typeof createInvoiceDocumentService>[3]})=>createInvoiceDocumentService(db,identity,options?.storage??storage,options?.render)
