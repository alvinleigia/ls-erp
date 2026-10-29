import { withInvoiceDocumentsApi } from "@/application/customer-invoices/http"
import { readJson } from "@/platform/business-api"
export const POST=(request:Request,context:{params:Promise<{id:string}>})=>withInvoiceDocumentsApi(request,async service=>{const value=await service.prepare((await context.params).id,await readJson(request));return {providerKey:value.providerKey,templateVersion:value.templateVersion,version:value.version,supersedesId:value.supersedesId,previewHash:value.fingerprint,title:value.payload.title,reference:value.payload.reference,date:value.payload.date}})
