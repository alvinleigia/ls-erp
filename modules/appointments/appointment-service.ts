import { bookingCreationOffice, bookingWriteOffice, assertBookingTarget, bookingOfficeLabels } from "./office"
import { AppointmentStatus, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { startOfBusinessDate } from "@/lib/business-time"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { AppointmentCreateInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { appointmentConflictReason } from "./appointment-conflicts"
import { requireServicesAccess } from "@/modules/services/policy"
import { requirePermission } from "@/platform/access/policy"
import { appointmentTransaction } from "./appointment-transaction"
import type { AppointmentAvailabilityResult, AppointmentRow } from "@/types/appointments"
import type { ListResponse } from "@/types/api"
import { appointmentInclude, serializeAppointment } from "./appointment-record"
import type { AppointmentAvailabilityInput, AppointmentListInput } from "./appointment-validation"

// Call within the Appointments API's authorized tenant context.
export async function listAppointments(tenantId: string, input: AppointmentListInput): Promise<ListResponse<AppointmentRow>> {
  const { page, pageSize, q, staffId, officeId, customerId, status, startDate, endDate, sort, order } = input
  const where: Prisma.AppointmentWhereInput = { tenantId, ...(officeId ? { officeId } : {}) }
  if (staffId) where.staffProfile = { userId: staffId, user: { tenantId } }
  if (customerId) where.customerId = customerId
  if (status) where.status = status
  if (startDate || endDate) {
    const settings = await prisma.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
    const timeZone = settings?.timeZone || "America/New_York"
    const nextDate = endDate ? new Date(`${endDate}T00:00:00.000Z`) : null
    if (nextDate) nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    where.startAt = {
      ...(startDate ? { gte: startOfBusinessDate(startDate, timeZone) } : {}),
      ...(nextDate ? { lt: startOfBusinessDate(nextDate.toISOString().slice(0, 10), timeZone) } : {}),
    }
  }
  if (q) {
    const text = { contains: q, mode: Prisma.QueryMode.insensitive }
    where.OR = [
      { customer: { name: text } }, { customer: { email: text } }, { service: { name: text } },
      { staffProfile: { user: { name: text } } }, { staffProfile: { user: { email: text } } },
    ]
  }
  const [total, appointments] = await prisma.$transaction([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({ where, include: appointmentInclude,
      orderBy: [{ [sort]: order }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { items: (await bookingOfficeLabels(prisma, tenantId, appointments)).map(serializeAppointment), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

async function participants(db: Prisma.TransactionClient, tenantId: string, input: AppointmentAvailabilityInput) {
  const [customer, service, staffProfile] = await Promise.all([
    input.customerId ? db.user.findFirst({ where: { id: input.customerId, tenantId }, select: { id: true, role: true, status: true } }) : null,
    db.service.findFirst({ where: { id: input.serviceId, tenantId }, select: { id: true, durationMinutes: true, status: true } }),
    db.staffProfile.findFirst({ where: { userId: input.staffId, user: { tenantId, role: "STAFF" } }, select: { id: true, user: { select: { status: true } } } }),
  ])
  return { customer, service, staffProfile }
}

export async function appointmentAvailability(actor: BusinessActor, input: AppointmentAvailabilityInput): Promise<AppointmentAvailabilityResult> {
  const { tenantId } = actor
  let sourceOffice: string | undefined
  if (input.appointmentId) {
    const current = await prisma.appointment.findFirst({ where: { tenantId, id: input.appointmentId }, select: { id: true, officeId: true } })
    if (!current) throw new BusinessError(404, "Appointment not found.")
    sourceOffice = current.officeId
  }
  const startAt = new Date(input.startAt)
  if (startAt <= new Date()) return { available: false, reason: "Cannot book appointments in the past." }
  const { staffProfile, service, customer } = await participants(prisma, tenantId, input)
  if (!staffProfile || staffProfile.user.status !== "ACTIVE") return { available: false, reason: "Staff member is not available." }
  if (!service || service.status !== "ACTIVE") return { available: false, reason: "Service is not active." }
  if (input.customerId && (!customer || customer.role !== "CUSTOMER" || customer.status !== "ACTIVE")) return { available: false, reason: "Customer is not active." }
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000)
  const office = sourceOffice ?? await bookingCreationOffice(actor)
  await assertBookingTarget(prisma, tenantId, office, staffProfile.id, startAt, endAt)
  const reason = await appointmentConflictReason(prisma, tenantId, { ...input, startAt, endAt, staffProfileId: staffProfile.id })
  return reason ? { available: false, reason } : { available: true }
}

export async function createAppointment(actor: BusinessActor, input: AppointmentCreateInput) {
  const { tenantId } = actor
  // Recheck availability under the same lock as schedule writers. All reads must
  // use this transaction connection, including the Workforce availability helper.
  const appointment = await appointmentTransaction(actor, "create", async (tx, actor) => {
    await requireServicesAccess(actor, "read", tx)
    if (input.status === "CANCELED") requirePermission(actor, "appointments.archive")
    const startAt = new Date(input.startAt)
    if (startAt <= new Date()) throw new BusinessError(400, "Cannot book appointments in the past.")
    const { customer, service, staffProfile } = await participants(tx, tenantId, input)
    if (!customer) throw new BusinessError(404, "Customer not found.")
    if (customer.role !== "CUSTOMER") throw new BusinessError(400, "Selected user is not a customer.")
    if (customer.status !== "ACTIVE") throw new BusinessError(400, "Customer is not active.")
    if (!service) throw new BusinessError(404, "Service not found.")
    if (service.status !== "ACTIVE") throw new BusinessError(400, "Service is not active.")
    if (!staffProfile) throw new BusinessError(404, "Staff profile not found.")
    if (staffProfile.user.status !== "ACTIVE") throw new BusinessError(400, "Staff member is not active.")
    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000)
    const officeId = await bookingWriteOffice(tx, actor)
    await assertBookingTarget(tx, tenantId, officeId, staffProfile.id, startAt, endAt)
    const reason = await appointmentConflictReason(tx, tenantId, { startAt, endAt, customerId: customer.id, staffProfileId: staffProfile.id })
    if (reason) throw new BusinessError(409, reason)
    const saved = await tx.appointment.create({
      data: { tenantId, officeId, customerId: customer.id, serviceId: service.id, staffProfileId: staffProfile.id,
        startAt, endAt, status: input.status ?? AppointmentStatus.SCHEDULED },
      include: appointmentInclude,
    })
    await recordDomainAuditEvent(tx, {
      tenantId, event: "appointment.created", entityType: "Appointment", entityId: saved.id,
      actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
      metadata: { officeId: saved.officeId, officeFamily: "appointments", customerId: saved.customerId, staffProfileId: saved.staffProfileId, serviceId: saved.serviceId },
      after: { status: saved.status, startAt: saved.startAt.toISOString(), endAt: saved.endAt.toISOString() },
    })
    return (await bookingOfficeLabels(tx, tenantId, [saved]))[0]
  })
  return { appointment: serializeAppointment(appointment) }
}
