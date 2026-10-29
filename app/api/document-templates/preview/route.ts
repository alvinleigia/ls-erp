import { withDocumentTemplatesApi } from "@/application/order-documents/http"
import { readJson } from "@/platform/business-api"
import { NextResponse } from "next/server"
export const POST=(request:Request)=>withDocumentTemplatesApi(request,async service=>new NextResponse(Buffer.from(await service.preview(await readJson(request))),{headers:{"Content-Type":"application/pdf","Content-Disposition":"attachment; filename=template-sample-preview.pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}}))
