import { bookingWriteOffice, assertBookingTarget, bookingOfficeLabels } from "./office"
import type { Appointment, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { wallTimeToInstant } from "@/lib/business-time"
import type { AppointmentUpdateInput, AppointmentResolveInput } from "@/lib/validation"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requireServicesAccess } from "@/modules/services/policy"
import { appointmentTransaction } from "./appointment-transaction"
import { synchronizeAppointmentOrders } from "./appointment-order-sync"
import { appointmentDetailInclude, serializeAppointment } from "./appointment-record"
import { activeAppointmentStatuses, appointmentConflictReason, assertAppointmentMovesAvailable } from "./appointment-conflicts"

const snapshot = (row: Appointment) => ({ id: row.id, status: row.status, customerId: row.customerId,
  serviceId: row.serviceId, staffProfileId: row.staffProfileId, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() })
const auditActor = (actor: BusinessActor) => ({ tenantId: actor.tenantId, actorUserId: actor.userId,
  actorRole: actor.role, requestId: actor.requestId, entityType: "Appointment" })
const stale = () => new BusinessError(409, "This appointment changed. Refresh before saving.")

export async function getAppointment(tenantId: string, id: string) {
  const row = await prisma.appointment.findFirst({ where: { tenantId, id }, include: appointmentDetailInclude })
  if (!row) throw new BusinessError(404, "Appointment not found.")
  return { appointment: serializeAppointment((await bookingOfficeLabels(prisma, tenantId, [row]))[0]) }
}

export async function updateAppointment(actor: BusinessActor, id: string, input: AppointmentUpdateInput) {
  return appointmentTransaction(actor, "edit", async (tx, actor) => {
    const { tenantId } = actor
    const current = await tx.appointment.findFirst({ where: { tenantId, id }, include: { staffProfile: { select: { userId: true } } } })
    if (!current) throw new BusinessError(404, "Appointment not found.")
    await bookingWriteOffice(tx, actor, current.officeId)
    const status = input.status ?? current.status
    if (status !== current.status && (status === "CANCELED" || current.status === "CANCELED")) requirePermission(actor, "appointments.archive")
    const activation = activeAppointmentStatuses.includes(status) && !activeAppointmentStatuses.includes(current.status)
    const schedulingFields = Boolean(input.startAt || input.serviceId || input.staffId || input.customerId)
    if (schedulingFields || (status !== current.status && activeAppointmentStatuses.includes(status))) await requireServicesAccess(actor, "read", tx)

    const startAt = input.startAt ? new Date(input.startAt) : current.startAt
    if ((input.startAt || activation) && startAt <= new Date()) throw new BusinessError(400, "Cannot reschedule to the past.")
    let duration = current.endAt.getTime() - current.startAt.getTime()
    let staffProfileId = current.staffProfileId
    if (schedulingFields || activation) {
      const [customer, service, staff] = await Promise.all([
        tx.user.findFirst({ where: { tenantId, id: input.customerId ?? current.customerId }, select: { id: true, role: true, status: true } }),
        tx.service.findFirst({ where: { tenantId, id: input.serviceId ?? current.serviceId }, select: { id: true, status: true, durationMinutes: true } }),
        tx.staffProfile.findFirst({ where: { userId: input.staffId ?? current.staffProfile.userId, user: { tenantId, role: "STAFF" } }, select: { id: true, user: { select: { status: true } } } }),
      ])
      const active = activeAppointmentStatuses.includes(status)
      if (input.customerId || active) {
        if (!customer) throw new BusinessError(404, "Customer not found.")
        if (customer.role !== "CUSTOMER") throw new BusinessError(400, "Selected user is not a customer.")
        if (customer.status !== "ACTIVE") throw new BusinessError(400, "Customer is not active.")
      }
      if (input.serviceId || active) {
        if (!service) throw new BusinessError(404, "Service not found.")
        if (service.status !== "ACTIVE") throw new BusinessError(400, "Service is not active.")
      }
      if (input.staffId || active) {
        if (!staff) throw new BusinessError(404, "Staff profile not found.")
        if (staff.user.status !== "ACTIVE") throw new BusinessError(400, "Staff member is not active.")
      }
      if (input.serviceId && input.serviceId !== current.serviceId && service) duration = service.durationMinutes * 60000
      if (staff) staffProfileId = staff.id
    }
    const endAt = new Date(startAt.getTime() + duration)
    if (schedulingFields || activation) await assertBookingTarget(tx, tenantId, current.officeId, staffProfileId, startAt, endAt)
    if ((schedulingFields || activation) && duration <= 0) throw new BusinessError(409, "Appointment duration must be positive.")
    const customerId = input.customerId ?? current.customerId
    if ((schedulingFields || activation) && activeAppointmentStatuses.includes(status)) {
      const reason = await appointmentConflictReason(tx, tenantId, { appointmentId: id, staffProfileId, customerId, startAt, endAt })
      if (reason) throw new BusinessError(409, reason)
    }
    const [saved] = await tx.appointment.updateManyAndReturn({
      where: { tenantId, id, updatedAt: current.updatedAt },
      data: { customerId, serviceId: input.serviceId ?? current.serviceId, staffProfileId, startAt, endAt, status },
      include: appointmentDetailInclude,
    })
    if (!saved) throw stale()
    await synchronizeAppointmentOrders(tx, actor, [{ before: current, after: saved }])
    await recordDomainAuditEvent(tx, { ...auditActor(actor), event: "appointment.updated", entityId: id, metadata: { officeId: current.officeId, officeFamily: "appointments" }, before: snapshot(current), after: snapshot(saved) })
    return { appointment: serializeAppointment((await bookingOfficeLabels(tx, tenantId, [saved]))[0]) }
  })
}

export async function cancelAppointment(actor: BusinessActor, id: string) {
  return appointmentTransaction(actor, "archive", async (tx, actor) => {
    const row = await tx.appointment.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!row) throw new BusinessError(404, "Appointment not found.")
    await bookingWriteOffice(tx, actor, row.officeId)
    if (row.status === "CANCELED") return { ok: true }
    const result = await tx.appointment.updateMany({ where: { tenantId: actor.tenantId, id, updatedAt: row.updatedAt }, data: { status: "CANCELED" } })
    if (result.count !== 1) throw stale()
    await synchronizeAppointmentOrders(tx, actor, [{ before: row, after: { ...row, status: "CANCELED" } }])
    await recordDomainAuditEvent(tx, { ...auditActor(actor), event: "appointment.canceled", entityId: id, metadata: { officeId: row.officeId, officeFamily: "appointments" }, before: { status: row.status }, after: { status: "CANCELED" } })
    return { ok: true }
  })
}

export async function resolveAppointments(actor: BusinessActor, input: AppointmentResolveInput) {
  return appointmentTransaction(actor, input.action === "cancel" ? "archive" : "edit", async (tx, actor) => {
    const { tenantId } = actor
    const ids = [...new Set(input.appointmentIds)]
    const rows = await tx.appointment.findMany({ where: { tenantId, id: { in: ids } }, orderBy: [{ startAt: "asc" }, { id: "asc" }],
      include: { customer: { select: { role: true, status: true } }, service: { select: { status: true } },
        staffProfile: { select: { user: { select: { role: true, status: true } } } } },
    })
    if (rows.length !== ids.length) throw new BusinessError(404, "One or more appointments were not found. Refresh the selection.")
    for (const office of new Set(rows.map(row => row.officeId))) await bookingWriteOffice(tx, actor, office)
    let moves = rows.map(row => ({ ...row }))
    let timeZone: string | undefined
    let targetStaffProfileId: string | undefined
    if (input.action === "cancel") {
      moves = moves.filter(row => row.status !== "CANCELED").map(row => ({ ...row, status: "CANCELED" }))
    } else {
      await requireServicesAccess(actor, "read", tx)
      if (input.action === "reassign") {
        const staff = await tx.staffProfile.findFirst({ where: { userId: input.targetStaffId, user: { tenantId, role: "STAFF", status: "ACTIVE" } }, select: { id: true } })
        if (!staff) throw new BusinessError(404, "Target staff profile not found.")
        targetStaffProfileId = staff.id
        moves = moves.filter(row => row.staffProfileId !== staff.id).map(row => ({ ...row, staffProfileId: staff.id }))
      } else {
        const settings = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
        timeZone = settings?.timeZone ?? "UTC"
        let start: Date
        try { start = new Date(wallTimeToInstant(`${input.rescheduleDate}T${input.rescheduleTime}`, timeZone)) }
        catch (error) { throw new BusinessError(400, (error as Error).message) }
        if (start <= new Date()) throw new BusinessError(400, "Cannot reschedule appointments to the past.")
        const delta = start.getTime() - rows[0].startAt.getTime()
        moves = delta === 0 ? [] : moves.map(row => ({ ...row, startAt: new Date(row.startAt.getTime() + delta), endAt: new Date(row.endAt.getTime() + delta) }))
      }
      for (const move of moves.filter(row => activeAppointmentStatuses.includes(row.status))) {
        if (move.endAt <= move.startAt) throw new BusinessError(409, "Appointment duration must be positive.")
        if (move.customer.role !== "CUSTOMER" || move.customer.status !== "ACTIVE") throw new BusinessError(400, "Customer is not active.")
        if (move.service.status !== "ACTIVE") throw new BusinessError(400, "Service is not active.")
        // Reassignment already validated its destination; rescheduling retains the current staff.
        if (input.action === "reschedule" && (move.staffProfile.user.role !== "STAFF" || move.staffProfile.user.status !== "ACTIVE")) throw new BusinessError(400, "Staff member is not active.")
      }
      for (const move of moves) await assertBookingTarget(tx, tenantId, move.officeId, move.staffProfileId, move.startAt, move.endAt)
      // Unchanged selected rows remain in the database conflict query.
      await assertAppointmentMovesAvailable(tx, tenantId, moves, moves.map(row => row.id))
    }
    if (!moves.length) return { updatedCount: 0 }
    const before = new Map(rows.map(row => [row.id, row]))
    for (const move of moves) {
      const data: Prisma.AppointmentUncheckedUpdateManyInput = input.action === "cancel" ? { status: "CANCELED" }
        : input.action === "reassign" ? { staffProfileId: move.staffProfileId } : { startAt: move.startAt, endAt: move.endAt }
      const saved = await tx.appointment.updateMany({ where: { tenantId, id: move.id, updatedAt: before.get(move.id)!.updatedAt }, data })
      if (saved.count !== 1) throw stale()
    }
    await synchronizeAppointmentOrders(tx, actor, moves.map(move => ({ before: before.get(move.id)!, after: move })))
    const event = input.action === "cancel" ? "appointment.bulk_canceled" : input.action === "reassign" ? "appointment.bulk_reassigned" : "appointment.bulk_rescheduled"
    for (const officeId of new Set(moves.map(row => row.officeId))) {
      const scoped = moves.filter(row => row.officeId === officeId)
      await recordDomainAuditEvent(tx, {
        ...auditActor(actor), event, before: scoped.map(move => snapshot(before.get(move.id)!)),
        after: input.action === "cancel" ? { status: "CANCELED" } : scoped.map(snapshot),
        metadata: { officeId, officeFamily: "appointments", appointmentIds: scoped.map(move => move.id), updatedCount: scoped.length,
          ...(input.action === "reassign" ? { targetStaffId: input.targetStaffId, targetStaffProfileId } : {}),
          ...(input.action === "reschedule" ? { rescheduleDate: input.rescheduleDate, rescheduleTime: input.rescheduleTime, timeZone } : {}),
        },
      })
    }
    return { updatedCount: moves.length }
  })
}
