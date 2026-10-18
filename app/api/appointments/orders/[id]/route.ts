import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { readJson } from "@/platform/business-api"
import { appointmentOrderUpdateSchema } from "@/lib/validation"
import { getOrder, updateOrder } from "@/modules/appointments/order-mutations"
import { AvailabilityConflictError } from "@/modules/appointments/order-scheduling"

type Context = { params: Promise<{ id: string }> }
export function GET(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointments", "read", async actor =>
    NextResponse.json(await getOrder(actor.tenantId, (await context.params).id)))
}
export function PATCH(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointments", "edit", async actor => {
    const input = appointmentOrderUpdateSchema.parse(await readJson(request))
    try { return NextResponse.json(await updateOrder(actor, (await context.params).id, input)) }
    catch (error) {
      if (error instanceof AvailabilityConflictError) return NextResponse.json({ error: error.message,
        suggestedStartAt: error.suggestedStartAt, canApplySuggestion: Boolean(error.suggestedStartAt) }, { status: 409 })
      throw error
    }
  })
}
