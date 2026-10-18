import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { revokeLeaveRequestSchema } from "@/lib/validation"
import { revokeLeaveRequest } from "@/modules/workforce/leave-request-service"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "leaves", "leaveApprovals", "archive", async actor => {
    const parsed = revokeLeaveRequestSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await revokeLeaveRequest(actor, id, parsed.data))
  }, "requests/[id]/revoke", id)
}
