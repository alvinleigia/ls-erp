import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { resolveAppointments } from "@/modules/appointments/appointment-mutations"
import { appointmentResolveSchema } from "@/lib/validation"
import { readJson } from "@/platform/business-api"
import { requirePermission } from "@/platform/access/policy"

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {
    const body = await readJson(request)
    const action = (body as { action?: unknown } | null)?.action
    requirePermission(actor, action === "cancel" ? "appointments.archive" : "appointments.edit")
    return NextResponse.json(await resolveAppointments(actor, appointmentResolveSchema.parse(body)))
  })
}
