import { NextResponse } from "next/server"
import { withInvoiceDocumentsApi } from "@/application/customer-invoices/http"
import { readJson } from "@/platform/business-api"
export const runtime="nodejs"
export const POST=(request:Request,context:{params:Promise<{id:string}>})=>withInvoiceDocumentsApi(request,async service=>new NextResponse(Buffer.from(await service.preview((await context.params).id,await readJson(request))),{headers:{"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline; filename=\"document-preview.pdf\""}}))
