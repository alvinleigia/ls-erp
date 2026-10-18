import { prisma } from "@/lib/prisma"
import type { DocumentBranding } from "@/platform/branding/types"
import { downloadDocumentLogo } from "@/platform/branding/storage"
import { businessDisplayName } from "@/lib/branding"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { canSendConfiguredEmail, mailer, mailFrom } from "@/lib/mailer"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { appointmentOrderInclude, serializeAppointmentOrder } from "./order-record"
import { buildAppointmentOrderInvoicePdf } from "./invoice-pdf"

// Both delivery paths use the same saved financial snapshot; catalog changes never reprice it.
async function invoiceSource(tenantId: string, id: string) {
  const order = await prisma.appointmentOrder.findFirst({ where: { tenantId, id }, include: appointmentOrderInclude })
  if (!order) throw new BusinessError(404, "Appointment order not found.")
  const [settings, tenant] = await Promise.all([
    prisma.appSetting.findUnique({ where: { tenantId }, select: {
      locale: true, currency: true, currencySymbolPlacement: true, numberFormat: true,
      dateFormat: true, timeFormat: true, timeZone: true,
    } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ])
  const branding = order.invoiceBranding as DocumentBranding | null
  return { order: serializeAppointmentOrder(order), businessName: businessDisplayName(branding?.name || tenant?.name),
    logo: branding?.logo ? await downloadDocumentLogo(branding.logo.path) : undefined, settings: settings ?? undefined }
}

export async function generateInvoice(tenantId: string, id: string) {
  return buildAppointmentOrderInvoicePdf(await invoiceSource(tenantId, id))
}

export async function emailInvoice(actor: BusinessActor, id: string) {
  requirePermission(actor, "appointments.edit")
  const source = await invoiceSource(actor.tenantId, id)
  const { order, businessName } = source
  if (!order.customer?.email) throw new BusinessError(400, "Customer email not available.")
  if (!mailFrom || !await canSendConfiguredEmail(prisma, actor.tenantId)) {
    throw new BusinessError(400, "Email notifications are disabled or SMTP is not configured.")
  }
  const pdf = await buildAppointmentOrderInvoicePdf(source)
  await mailer.sendMail({
    to: order.customer.email, from: mailFrom, subject: `Invoice ${order.id.slice(-6)}`,
    text: `Hi ${order.customer.name || "customer"},\n\nPlease find your invoice attached.\n\nThanks,\n${businessName}`,
    attachments: [{ filename: `invoice-${order.id}.pdf`, content: pdf, contentType: "application/pdf" }],
  })
  // Delivery is external, so a later audit failure must not turn a sent email into a retryable 500.
  await recordDomainAuditEventSafe(prisma, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role,
    requestId: actor.requestId, event: "appointments.invoice.emailed", entityType: "order", entityId: id,
    metadata: { recipient: order.customer.email, orderUpdatedAt: order.updatedAt },
    after: JSON.parse(JSON.stringify(order)),
  })
  return { ok: true }
}
