import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { getLeaveRequest } from "@/modules/workforce/leave-request-service"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "leaves", "leaveRequests", "read", async actor =>
    NextResponse.json(await getLeaveRequest(actor, id, new URL(request.url).searchParams.get("includeRuleChecks") === "true")), "requests/[id]", id)
}
