import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { clonePattern } from "@/modules/workforce/flexible-plan-service"
import { clonePatternSchema } from "@/modules/workforce/flexible-plan-validation"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "shifts", "shiftPlans", "create", async actor => {
    const data = clonePatternSchema.parse(await request.json().catch(() => null))
    return NextResponse.json(await clonePattern(actor, id, data))
  }, "flexible-patterns/[id]/clone", id)
}
