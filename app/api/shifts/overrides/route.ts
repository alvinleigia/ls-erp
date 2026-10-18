import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { shiftOverrideSchema } from "@/lib/validation"
import { workforceDateRangeSchema, deleteOverrideSchema } from "@/modules/workforce/schedule-validation"
import { listShiftOverrides, saveShiftOverrides, deleteShiftOverrides } from "@/modules/workforce/roster-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", async actor => {
    const query = workforceDateRangeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listShiftOverrides(actor.tenantId, query))
  }, "overrides")
}
export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", async actor => {
    const data = shiftOverrideSchema.parse(await request.json().catch(() => null))
    const result = await saveShiftOverrides(actor, data)
    return NextResponse.json(result, { status: "error" in result ? 409 : 200 })
  }, "overrides")
}
export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "archive", async actor => {
    const data = deleteOverrideSchema.parse(await request.json().catch(() => null))
    const result = await deleteShiftOverrides(actor, data)
    return NextResponse.json(result, { status: "error" in result ? 409 : 200 })
  }, "overrides")
}
