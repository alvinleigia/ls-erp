import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { bookingStaffChoicesSchema, bookingStaffChoices } from "@/modules/appointments/choices"
export function GET(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => NextResponse.json(await bookingStaffChoices(actor, bookingStaffChoicesSchema.parse(Object.fromEntries(new URL(request.url).searchParams)))))
}
