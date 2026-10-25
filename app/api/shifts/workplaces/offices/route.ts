import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { listWorkplaceOffices, workplaceQuerySchema } from "@/modules/workforce/workplace-service"

export function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "edit", async actor => {
    const query = workplaceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await listWorkplaceOffices(actor, query))
  }, "workplaces/offices")
}
