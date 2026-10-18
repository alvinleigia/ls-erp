import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { shiftScheduleSchema } from "@/lib/validation"
import { shiftScheduleListSchema } from "@/modules/workforce/schedule-validation"
import { listShiftSchedules, saveShiftSchedule } from "@/modules/workforce/shift-schedule-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "read", async actor => {
    const parsed = shiftScheduleListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await listShiftSchedules(actor.tenantId, parsed.data))
  }, "schedules")
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "create", async actor => {
    const parsed = shiftScheduleSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await saveShiftSchedule(actor, parsed.data))
  }, "schedules")
}
