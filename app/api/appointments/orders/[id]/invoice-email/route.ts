import { withAppointmentsApi } from "@/modules/appointments/api"
import { requirePermission } from "@/platform/access/policy"
import { businessDisplayName } from "@/lib/branding"
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
import { canSendConfiguredEmail, mailer, mailFrom } from "@/lib/mailer"
import { buildAppointmentOrderInvoicePdf } from "@/lib/invoice"
import { appointmentOrderInclude, serializeAppointmentOrder } from "../../_helpers"

export const runtime = "nodejs"

async function handlePOST(
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
    if (!order.customer?.email) {
      const response = NextResponse.json({ error: "Customer email not available." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "missing_customer_email", orderId: id })
      return withRequestId(response, logContext.requestId)
    }
    if (!mailFrom || !(await canSendConfiguredEmail(prisma, tenantId))) {
      const response = NextResponse.json(
        { error: "Email notifications are disabled or SMTP is not configured." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "email_not_configured", orderId: id })
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

  const subject = `Invoice ${order.id.slice(-6)}`
  const customerName = order.customer?.name || "customer"
  const from = mailFrom
  const businessName = businessDisplayName(tenantSession.context.tenantName)

    await mailer.sendMail({
      to: order.customer.email,
      from,
      subject,
      text: `Hi ${customerName},\n\nPlease find your invoice attached.\n\nThanks,\n${businessName}`,
      attachments: [
        {
          filename: `invoice-${order.id}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    })

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { orderId: id, sentTo: order.customer.email })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to send invoice email." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withAppointmentsApi(request, "appointments", "export", async actor => {
    requirePermission(actor, "appointments.edit")
    return handlePOST(request, context)
  }, { kind: "order", id: (await context.params).id }, "appointments.invoice.emailed")
}
