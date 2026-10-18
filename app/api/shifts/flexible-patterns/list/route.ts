import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { patternListSchema } from "@/modules/workforce/flexible-plan-validation"
import { listPatterns } from "@/modules/workforce/flexible-plan-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", async actor => {
    const query = patternListSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listPatterns(actor.tenantId, query))
  }, "flexible-patterns/list")
}
