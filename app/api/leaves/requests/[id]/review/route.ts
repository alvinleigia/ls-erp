import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { reviewLeaveRequestSchema } from "@/lib/validation"
import { reviewLeaveRequest, LeaveApprovalConflictError } from "@/modules/workforce/leave-request-service"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "leaves", "leaveApprovals", "approve", async actor => {
    const parsed = reviewLeaveRequestSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    try {
      return NextResponse.json(await reviewLeaveRequest(actor, id, parsed.data))
    } catch (error) {
      if (error instanceof LeaveApprovalConflictError) return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: 409 })
      throw error
    }
  }, "requests/[id]/review", id)
}
