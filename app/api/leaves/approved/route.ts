import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { listApprovedLeaves } from "@/modules/workforce/leave-query-service"
import { workforceDateRangeSchema } from "@/modules/workforce/schedule-validation"

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveApprovals", "read", async actor => {
    const parsed = workforceDateRangeSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await listApprovedLeaves(actor, parsed.data))
  }, "approved")
}
