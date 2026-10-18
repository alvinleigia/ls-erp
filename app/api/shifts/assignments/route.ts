import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { workforceDateRangeSchema } from "@/modules/workforce/schedule-validation"
import { listShiftAssignments } from "@/modules/workforce/shift-schedule-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "read", async actor => {
    const parsed = workforceDateRangeSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await listShiftAssignments(actor.tenantId, parsed.data))
  }, "assignments")
}
