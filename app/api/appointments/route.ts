import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { requireServicesAccess } from "@/modules/services/policy"
import { readJson } from "@/platform/business-api"
import { appointmentCreateSchema } from "@/lib/validation"
import { appointmentListSchema } from "@/modules/appointments/appointment-validation"
import { createAppointment, listAppointments } from "@/modules/appointments/appointment-service"

export function GET(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {
    const input = appointmentListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listAppointments(actor.tenantId, input))
  })
}

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "create", async actor => {
    await requireServicesAccess(actor)
    const input = appointmentCreateSchema.parse(await readJson(request))
    return NextResponse.json(await createAppointment(actor, input), { status: 201 })
  })
}
