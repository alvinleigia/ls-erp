import { NextResponse } from "next/server"
import { withPaymentDocumentsApi } from "@/application/payment-documents/http"
import { z } from "zod"
export const runtime="nodejs"
export const GET=(request:Request,context:{params:Promise<{id:string;documentId:string}>})=>withPaymentDocumentsApi(request,async service=>{const {id,documentId}=await context.params,providerKey=z.string().min(1).max(72).parse(new URL(request.url).searchParams.get("providerKey"));return NextResponse.redirect(await service.download(id,documentId,providerKey,new URL(request.url).searchParams.get("acknowledgeReversal")==="true"),303)})
