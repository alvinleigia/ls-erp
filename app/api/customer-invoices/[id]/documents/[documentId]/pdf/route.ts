import { NextResponse } from "next/server"
import { withInvoiceDocumentsApi } from "@/application/customer-invoices/http"
import { z } from "zod"
export const runtime="nodejs"
export const GET=(request:Request,context:{params:Promise<{id:string;documentId:string}>})=>withInvoiceDocumentsApi(request,async service=>{const {id,documentId}=await context.params,providerKey=z.string().min(1).max(72).parse(new URL(request.url).searchParams.get("providerKey"));return NextResponse.redirect(await service.download(id,documentId,providerKey,new URL(request.url).searchParams.get("acknowledgeHistorical")==="true"),303)})
