import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { getLeaveRequestOptions } from "@/modules/workforce/leave-query-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "read", async actor =>
    NextResponse.json(await getLeaveRequestOptions(actor)), "request-options")
}
