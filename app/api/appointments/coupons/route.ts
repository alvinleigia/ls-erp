import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { listCoupons, createCoupon } from "@/modules/appointments/coupon-service"
import { couponListSchema } from "@/modules/appointments/coupon-validation"
import { couponCreateSchema } from "@/lib/validation"
import { readJson } from "@/platform/business-api"

export async function GET(request: Request) {
  return withAppointmentsApi(request, "appointmentCoupons", "read", async actor =>
    NextResponse.json(await listCoupons(actor.tenantId, couponListSchema.parse(Object.fromEntries(new URL(request.url).searchParams)))))
}
export async function POST(request: Request) {
  return withAppointmentsApi(request, "appointmentCoupons", "create", async actor =>
    NextResponse.json({ coupon: await createCoupon(actor, couponCreateSchema.parse(await readJson(request))) }, { status: 201 }))
}
