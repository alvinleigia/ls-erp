import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { workforceDateRangeSchema } from "@/modules/workforce/schedule-validation"
import { listRosterHistory } from "@/modules/workforce/roster-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", async actor => {
    const query = workforceDateRangeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listRosterHistory(actor, query))
  }, "history")
}
