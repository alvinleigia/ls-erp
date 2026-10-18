import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { cancelLeaveRequestSchema } from "@/lib/validation"
import { cancelLeaveRequest } from "@/modules/workforce/leave-request-service"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "leaves", "leaveRequests", "archive", async actor => {
    const parsed = cancelLeaveRequestSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await cancelLeaveRequest(actor, id, parsed.data))
  }, "requests/[id]/cancel", id)
}
