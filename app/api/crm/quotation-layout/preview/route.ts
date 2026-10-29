import { NextResponse } from "next/server"
import { withCrmApi } from "@/application/crm/http"
import { readJson } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"
export const POST=(request:Request)=>withCrmApi(request,async service=>{
  const url=new URL(request.url),host=request.headers.get("x-forwarded-host")||request.headers.get("host")||url.host,protocol=request.headers.get("x-forwarded-proto")||url.protocol.replace(":","")
  const origin=request.headers.get("origin");if(origin&&origin!==`${protocol}://${host}`)throw new BusinessError(403,"Cross-origin document previews are not permitted.")
  return new NextResponse(Buffer.from(await service.previewQuotationLayout(await readJson(request))),{headers:{"Content-Type":"application/pdf","Content-Disposition":"attachment; filename=quotation-layout-sample.pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})
})
