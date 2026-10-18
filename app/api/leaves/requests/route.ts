import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { BusinessError } from "@/platform/policy"
import { createLeaveRequestSchema } from "@/lib/validation"
import { leaveRequestListSchema, listLeaveRequests, submitLeaveRequest } from "@/modules/workforce/leave-request-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "read", async actor => {
    const parsed = leaveRequestListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()))
    if (!parsed.success) return NextResponse.json({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 })
    return NextResponse.json(await listLeaveRequests(actor, parsed.data))
  }, "requests")
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveRequests", "create", async actor => {
    const parsed = createLeaveRequestSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: "Invalid input.", details: parsed.error.flatten() }, { status: 400 })
    try {
      return NextResponse.json(await submitLeaveRequest(actor, parsed.data), { status: 201 })
    } catch (error) {
      if (error instanceof BusinessError) throw error
      if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 })
      throw error
    }
  }, "requests")
}
