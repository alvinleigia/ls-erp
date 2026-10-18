import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { emailInvoice } from "@/modules/appointments/invoice-service"

export const runtime = "nodejs"
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointments", "export", async actor =>
    NextResponse.json(await emailInvoice(actor, (await context.params).id)))
}
