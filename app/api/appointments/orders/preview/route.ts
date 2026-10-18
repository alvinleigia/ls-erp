import { NextResponse } from "next/server"
import { z } from "zod"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { readJson } from "@/platform/business-api"
import { appointmentOrderCreateSchema } from "@/lib/validation"
import { previewOrder } from "@/modules/appointments/order-preview"

const schema = z.object({ orderId: z.string().trim().min(1).max(200).optional(), input: appointmentOrderCreateSchema })

export function POST(request: Request) {
  return withAppointmentsApi(request, "appointments", "read", async actor => {
    const { orderId, input } = schema.parse(await readJson(request))
    return NextResponse.json(await previewOrder(actor, input, orderId))
  })
}
