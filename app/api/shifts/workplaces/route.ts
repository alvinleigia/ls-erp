import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { staffWorkplaceSchema } from "@/lib/validation"
import { readJson } from "@/platform/business-api"
import { readStaffWorkplace, changeStaffWorkplace, workplaceQuerySchema } from "@/modules/workforce/workplace-service"

export function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", async actor => {
    const query = workplaceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await readStaffWorkplace(actor, query))
  }, "workplaces")
}
export function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", async actor => {
    return NextResponse.json(await changeStaffWorkplace(actor, staffWorkplaceSchema.parse(await readJson(request))))
  }, "workplaces")
}
