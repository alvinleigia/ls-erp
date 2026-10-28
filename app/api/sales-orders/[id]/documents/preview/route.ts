import { NextResponse } from "next/server"
import { withOrderDocumentsApi } from "@/application/order-documents/http"
import { readJson } from "@/platform/business-api"
export const runtime="nodejs"
export const POST=(request:Request,context:{params:Promise<{id:string}>})=>withOrderDocumentsApi(request,async service=>new NextResponse(Buffer.from(await service.preview((await context.params).id,await readJson(request))),{headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=\"document-preview.pdf\""}}))
