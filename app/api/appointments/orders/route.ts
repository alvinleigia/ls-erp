import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { readJson } from "@/platform/business-api"
import { appointmentOrderCreateSchema } from "@/lib/validation"
import { orderListSchema } from "@/modules/appointments/order-validation"
import { createOrder, listOrders } from "@/modules/appointments/order-service"
import { AvailabilityConflictError } from "@/modules/appointments/order-scheduling"

export function GET(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {
    const input = orderListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listOrders(actor.tenantId, input))
  })
}

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "create", async actor => {
    const input = appointmentOrderCreateSchema.parse(await readJson(request))
    try {
      return NextResponse.json(await createOrder(actor, input), { status: 201 })
    } catch (error) {
      if (error instanceof AvailabilityConflictError) return NextResponse.json({ error: error.message,
        suggestedStartAt: error.suggestedStartAt, canApplySuggestion: Boolean(error.suggestedStartAt) }, { status: 409 })
      throw error
    }
  })
}
