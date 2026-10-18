import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { impactPreviewSchema } from "@/modules/workforce/flexible-plan-validation"
import { previewPatternImpact } from "@/modules/workforce/flexible-plan-preview"

export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", async actor => {
    const data = impactPreviewSchema.parse(await request.json().catch(() => null))
    return NextResponse.json(await previewPatternImpact(actor, data))
  }, "flexible-patterns/impact-preview")
}
