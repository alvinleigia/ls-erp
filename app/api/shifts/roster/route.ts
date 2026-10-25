import { NextResponse } from "next/server"
import { withWorkforceApi } from "@/modules/workforce/api"
import { readRoster, rosterReadSchema } from "@/modules/workforce/roster-read"

export function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftRoster", "read", async actor => {
    const query = rosterReadSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await readRoster(actor, query))
  }, "roster")
}
