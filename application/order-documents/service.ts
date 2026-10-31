import type { PrismaClient } from "@prisma/client"
import { createOrderDocumentService } from "@/modules/sales-orders/documents"
import { orderAcknowledgement } from "@/modules/sales-orders/document-provider"
import { realEstateOrderDocuments } from "@/modules/real-estate/order-documents"
import { readReceivableDocumentEvidence } from "@/modules/receivables/document-evidence"
import { createDocumentTemplateService } from "@/platform/documents/template-service"
import { paymentReceiptProvider } from "@/modules/receivables/receipt-template"
import { invoiceDocumentProviders } from "@/modules/customer-invoices/document-provider"
import { statutoryTemplateTypes } from "@/platform/tax/localizations/india-statutory-pdf"
import { uploadOrderDocumentPdf,removeUnusedPdf,archivedPdfUrl } from "@/platform/storage/documents"
import type { DocumentIdentity,DocumentStorage } from "@/platform/documents/contracts"
export const orderDocumentProviders=[orderAcknowledgement,...realEstateOrderDocuments(readReceivableDocumentEvidence)]
const storage:DocumentStorage={upload:uploadOrderDocumentPdf,remove:removeUnusedPdf,url:archivedPdfUrl}
export const applicationOrderDocuments=(db:PrismaClient,identity:DocumentIdentity,options?:{storage?:DocumentStorage;render?:Parameters<typeof createOrderDocumentService>[4]})=>createOrderDocumentService(db,identity,orderDocumentProviders,options?.storage??storage,options?.render)
export const applicationDocumentTemplates=(db:PrismaClient,identity:DocumentIdentity)=>createDocumentTemplateService(db,identity,[...orderDocumentProviders,paymentReceiptProvider,...invoiceDocumentProviders,...statutoryTemplateTypes])
