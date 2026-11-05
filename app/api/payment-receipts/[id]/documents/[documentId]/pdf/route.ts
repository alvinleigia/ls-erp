import { documentPdfResponse } from "@/platform/documents/http"
import { documentVariantSchema } from "@/platform/documents/letterhead"
import { withPaymentDocumentsApi } from "@/application/payment-documents/http"
import { z } from "zod"
export const runtime="nodejs"
export const GET=(request:Request,context:{params:Promise<{id:string;documentId:string}>})=>withPaymentDocumentsApi(request,async service=>{const {id,documentId}=await context.params,query=new URL(request.url).searchParams,providerKey=z.string().min(1).max(72).parse(query.get("providerKey")),variant=documentVariantSchema.parse(query.get("variant")??"digital");return documentPdfResponse(await service.download(id,documentId,providerKey,query.get("acknowledgeReversal")==="true",variant))})
