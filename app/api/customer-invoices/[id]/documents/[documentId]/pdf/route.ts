import { documentPdfResponse } from "@/platform/documents/http"
import { documentVariantSchema } from "@/platform/documents/letterhead"
import { withInvoiceDocumentsApi } from "@/application/customer-invoices/http"
import { z } from "zod"
export const runtime="nodejs"
export const GET=(request:Request,context:{params:Promise<{id:string;documentId:string}>})=>withInvoiceDocumentsApi(request,async service=>{const {id,documentId}=await context.params,query=new URL(request.url).searchParams,providerKey=z.string().min(1).max(72).parse(query.get("providerKey")),variant=documentVariantSchema.parse(query.get("variant")??"digital");return documentPdfResponse(await service.download(id,documentId,providerKey,query.get("acknowledgeHistorical")==="true",variant))})
