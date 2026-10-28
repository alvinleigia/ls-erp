import { NextResponse } from "next/server"
import { withOrderDocumentsApi } from "@/application/order-documents/http"
import { z } from "zod"
export const runtime="nodejs"
export const GET=(request:Request,context:{params:Promise<{id:string;documentId:string}>})=>withOrderDocumentsApi(request,async service=>{const {id,documentId}=await context.params,providerKey=z.string().min(1).max(72).parse(new URL(request.url).searchParams.get("providerKey"));return NextResponse.redirect(await service.download(id,documentId,providerKey),303)})
