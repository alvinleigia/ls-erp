import { NextResponse } from "next/server"
import { withCoreApi } from "@/platform/core/api"
import { dashboardSummary } from "@/application/dashboard/summary"
import { createApiLogContext, logApiRequestError, logApiRequestStart, logApiRequestSuccess, withRequestId } from "@/lib/api-logging"

export async function GET(request: Request) {
  return withCoreApi(request, "dashboard", "read", async actor => {
    const logContext = createApiLogContext(request)
    logApiRequestStart(logContext, request)
    try {
      const query = new URL(request.url).searchParams
      const payload = await dashboardSummary(actor, {
        range: (query.get("range") || "week").toLowerCase(),
        startDateRaw: query.get("startDate"), endDateRaw: query.get("endDate"),
        debug: query.get("debug") === "1",
        host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"),
      })
      logApiRequestSuccess(logContext, 200, { range: payload.range.label, points: payload.series.daily.length, upcomingCount: payload.upcomingAppointments.length })
      return withRequestId(NextResponse.json(payload), logContext.requestId)
    } catch (error) {
      logApiRequestError(logContext, error, 500)
      return withRequestId(NextResponse.json({ error: "Unable to load dashboard summary." }, { status: 500 }), logContext.requestId)
    }
  })
}
