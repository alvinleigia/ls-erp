import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { requirePermission } from "@/platform/access/policy"
import { couponReportQuery, couponUsageReport } from "@/modules/appointments/coupon-report"

export async function GET(request: Request) {
  return withAppointmentsApi(request, "appointmentCoupons", "read", async actor => {
    requirePermission(actor, "appointments.read")
    const query = couponReportQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await couponUsageReport(actor, query))
  })
}
