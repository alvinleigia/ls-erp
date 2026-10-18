import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { getAppointment, updateAppointment, cancelAppointment } from "@/modules/appointments/appointment-mutations"
import { appointmentUpdateSchema } from "@/lib/validation"
import { readJson } from "@/platform/business-api"

type Context = { params: Promise<{ id: string }> }

export function GET(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointments", "read", async actor =>
    NextResponse.json(await getAppointment(actor.tenantId, (await context.params).id)))
}

export function PATCH(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointments", "edit", async actor => {
    const input = appointmentUpdateSchema.parse(await readJson(request))
    return NextResponse.json(await updateAppointment(actor, (await context.params).id, input))
  })
}

export function DELETE(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointments", "archive", async actor =>
    NextResponse.json(await cancelAppointment(actor, (await context.params).id)))
}
