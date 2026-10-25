import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { shiftScheduleEditSchema } from "@/lib/validation"
import { saveShiftSchedule, deleteShiftSchedule } from "@/modules/workforce/shift-schedule-service"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "shifts", "shiftSchedules", "edit", async actor => {
    const parsed = shiftScheduleEditSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await saveShiftSchedule(actor, parsed.data, id))
  }, "schedules/[id]", id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "shifts", "shiftSchedules", "archive", async actor =>
    NextResponse.json(await deleteShiftSchedule(actor, id)), "schedules/[id]", id)
}
