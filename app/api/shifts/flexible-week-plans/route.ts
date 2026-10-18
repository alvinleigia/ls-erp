import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { flexibleWeekPlanSchema } from "@/lib/validation"
import { weekPlanQuerySchema, deleteWeekPlanSchema } from "@/modules/workforce/flexible-plan-validation"
import { getWeekPlans, saveWeekPlan, deleteWeekPlan } from "@/modules/workforce/flexible-plan-service"

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", async actor => {
    const query = weekPlanQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await getWeekPlans(actor.tenantId, query))
  }, "flexible-week-plans")
}
export async function PUT(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", async actor => {
    const data = flexibleWeekPlanSchema.parse(await request.json().catch(() => null))
    return NextResponse.json(await saveWeekPlan(actor, data))
  }, "flexible-week-plans")
}
export async function DELETE(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "archive", async actor => {
    const data = deleteWeekPlanSchema.parse(await request.json().catch(() => null))
    return NextResponse.json(await deleteWeekPlan(actor, data))
  }, "flexible-week-plans")
}
