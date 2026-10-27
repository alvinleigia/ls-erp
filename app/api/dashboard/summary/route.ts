import { NextResponse } from "next/server"
import { withCoreApi } from "@/platform/core/api"
import { dashboardSummary } from "@/application/dashboard/summary"
import { dashboardSelectionSchema } from "@/application/dashboard/validation"

export async function GET(request:Request) {
  return withCoreApi(request,"dashboard","read",async actor=>{
    const query=new URL(request.url).searchParams,input=Object.fromEntries(query)
    delete input.debug
    const selection=dashboardSelectionSchema.parse(input)
    return NextResponse.json(await dashboardSummary(actor,{
      range:selection.range,startDateRaw:selection.startDate||null,endDateRaw:selection.endDate||null,attribution:selection,
      debug:query.get("debug")==="1",host:request.headers.get("host"),forwardedHost:request.headers.get("x-forwarded-host"),
    }))
  })
}
