import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { flexibleSlotSchema } from "@/lib/validation"
import { workforceDateRangeSchema, deleteFlexibleSlotSchema } from "@/modules/workforce/schedule-validation"
import { listFlexibleSlots, saveFlexibleSlots, deleteFlexibleSlots } from "@/modules/workforce/roster-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", async actor => {
    const query = workforceDateRangeSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listFlexibleSlots(actor.tenantId, query))
  }, "flexible-slots")
}
export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", async actor => {
    const data = flexibleSlotSchema.parse(await request.json().catch(() => null))
    const result = await saveFlexibleSlots(actor, data)
    return NextResponse.json(result, { status: "error" in result ? 409 : 200 })
  }, "flexible-slots")
}
export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "archive", async actor => {
    const data = deleteFlexibleSlotSchema.parse(await request.json().catch(() => null))
    const result = await deleteFlexibleSlots(actor, data)
    return NextResponse.json(result, { status: "error" in result ? 409 : 200 })
  }, "flexible-slots")
}
