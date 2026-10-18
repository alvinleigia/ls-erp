import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { generateInvoice } from "@/modules/appointments/invoice-service"

export const runtime = "nodejs"
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointments", "export", async actor => {
    const { id } = await context.params
    const pdf = await generateInvoice(actor.tenantId, id)
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"
    return new NextResponse(new Uint8Array(pdf), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="invoice-${id}.pdf"`,
    } })
  })
}
