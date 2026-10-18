import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { bulkReviewLeaveRequestsSchema } from "@/lib/validation"
import { bulkReviewLeaveRequests, LeaveApprovalConflictError } from "@/modules/workforce/leave-request-service"

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveApprovals", "approve", async actor => {
    const parsed = bulkReviewLeaveRequestsSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    try {
      return NextResponse.json(await bulkReviewLeaveRequests(actor, parsed.data))
    } catch (error) {
      if (error instanceof LeaveApprovalConflictError) return NextResponse.json({
        error: error.message, conflicts: error.conflicts, blockedRequestIds: error.blockedRequestIds,
      }, { status: 409 })
      throw error
    }
  }, "requests/review-bulk")
}
