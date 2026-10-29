import { NextResponse } from "next/server"
import { withPaymentDocumentsApi } from "@/application/payment-documents/http"
import { readJson } from "@/platform/business-api"
export const runtime="nodejs"
export const POST=(request:Request,context:{params:Promise<{id:string}>})=>withPaymentDocumentsApi(request,async service=>new NextResponse(Buffer.from(await service.preview((await context.params).id,await readJson(request))),{headers:{"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline; filename=\"document-preview.pdf\""}}))
