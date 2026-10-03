import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { requireTenantSession } from "@/lib/tenant-auth"
import { buildAppointmentOrderInvoicePdf } from "@/lib/invoice"
import { appointmentOrderInclude, serializeAppointmentOrder } from "../../_helpers"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "unauthorized_or_invalid_tenant" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { id } = await params
    const order = await prisma.appointmentOrder.findFirst({
      where: { id, tenantId },
      include: appointmentOrderInclude,
    })
    if (!order) {
      const response = NextResponse.json({ error: "Appointment order not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", orderId: id })
      return withRequestId(response, logContext.requestId)
    }

  const settings = await prisma.appSetting.findUnique({
    where: { tenantId },
    select: {
      locale: true,
      currency: true,
      currencySymbolPlacement: true,
      numberFormat: true,
      dateFormat: true,
      timeFormat: true,
    },
  })

    const pdf = await buildAppointmentOrderInvoicePdf({
      order: serializeAppointmentOrder(order),
    businessName: tenantSession.context.tenantName,
      settings: settings ?? undefined,
    })

    const url = new URL(request.url)
    const download = url.searchParams.get("download") === "1"
    const disposition = download ? "attachment" : "inline"

    const response = new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename=\"invoice-${order.id}.pdf\"`,
      },
    })
    logApiRequestSuccess(logContext, 200, { orderId: id, download })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to generate invoice." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}
