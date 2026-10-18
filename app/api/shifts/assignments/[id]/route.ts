import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { updateAssignmentSchema } from "@/modules/workforce/schedule-validation"
import { endShiftAssignment } from "@/modules/workforce/shift-schedule-service"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "shifts", "shiftSchedules", "archive", async actor => {
    const parsed = updateAssignmentSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await endShiftAssignment(actor, id, parsed.data.endDate))
  }, "assignments/[id]", id)
}
