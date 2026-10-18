import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { getPattern } from "@/modules/workforce/flexible-plan-service"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", async actor => {
    return NextResponse.json(await getPattern(actor.tenantId, id))
  }, "flexible-patterns/[id]", id)
}
