import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { flexiblePatternSchema } from "@/lib/validation"
import { patternQuerySchema, deletePatternSchema } from "@/modules/workforce/flexible-plan-validation"
import { getPatterns, savePattern, deactivatePattern } from "@/modules/workforce/flexible-plan-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", async actor => {
    const query = patternQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await getPatterns(actor.tenantId, query))
  }, "flexible-patterns")
}
export async function PUT(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "edit", async actor => {
    const data = flexiblePatternSchema.parse(await request.json().catch(() => null))
    return NextResponse.json(await savePattern(actor, data))
  }, "flexible-patterns")
}
export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "archive", async actor => {
    const data = deletePatternSchema.parse(await request.json().catch(() => null))
    return NextResponse.json(await deactivatePattern(actor, data.patternId))
  }, "flexible-patterns")
}
