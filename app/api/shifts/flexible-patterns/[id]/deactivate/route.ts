import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { deactivatePattern } from "@/modules/workforce/flexible-plan-service"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withWorkforceApi(request, "shifts", "shiftPlans", "archive", async actor => {
    return NextResponse.json(await deactivatePattern(actor, id))
  }, "flexible-patterns/[id]/deactivate", id)
}
