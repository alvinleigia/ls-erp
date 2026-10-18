import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { requireServicesAccess } from "@/modules/services/policy"
import { readJson } from "@/platform/business-api"
import { appointmentAvailabilitySchema } from "@/modules/appointments/appointment-validation"
import { appointmentAvailability } from "@/modules/appointments/appointment-service"

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {
    await requireServicesAccess(actor)
    const input = appointmentAvailabilitySchema.parse(await readJson(request))
    return NextResponse.json(await appointmentAvailability(actor.tenantId, input))
  })
}
