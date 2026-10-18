import { NextResponse } from "next/server"
import { withAppointmentsApi } from "@/modules/appointments/api"
import { updateCoupon, deleteCoupon } from "@/modules/appointments/coupon-service"
import { couponUpdateSchema } from "@/lib/validation"
import { readJson } from "@/platform/business-api"

type Context = { params: Promise<{ id: string }> }
export async function PATCH(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointmentCoupons", "edit", async actor =>
    NextResponse.json({ coupon: await updateCoupon(actor, (await context.params).id, couponUpdateSchema.parse(await readJson(request))) }))
}
export async function DELETE(request: Request, context: Context) {
  return withAppointmentsApi(request, "appointmentCoupons", "archive", async actor =>
    NextResponse.json(await deleteCoupon(actor, (await context.params).id)))
}
