import type { Appointment, Prisma } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { wallTime } from "@/lib/business-time"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { activeAppointmentStatuses } from "./appointment-conflicts"

type Change = { before: Appointment; after: Appointment }
const value = (row: Appointment) => ({ id: row.id, orderLineId: row.orderLineId, status: row.status,
  customerId: row.customerId, serviceId: row.serviceId, staffProfileId: row.staffProfileId,
  startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() })
const moved = (a: Appointment, b: Appointment) => a.staffProfileId !== b.staffProfileId ||
  a.startAt.getTime() !== b.startAt.getTime() || a.endAt.getTime() !== b.endAt.getTime()

// Called within the appointment transaction. Appointment status is operational;
// order status, prices, coupons and stock are changed only by explicit order actions.
export async function synchronizeAppointmentOrders(tx: Prisma.TransactionClient, actor: BusinessActor, changes: Change[]) {
  const linked = changes.filter(({ before, after }) => before.orderLineId && JSON.stringify(value(before)) !== JSON.stringify(value(after)))
  if (!linked.length) return
  const lineIds = linked.map(change => change.before.orderLineId!)
  const orders = await tx.appointmentOrder.findMany({ where: { tenantId: actor.tenantId, lines: { some: { id: { in: lineIds } } } },
    select: { id: true, officeId: true, status: true, customerId: true, appointmentDate: true, appointmentStartAt: true,
      lines: { select: { id: true, serviceId: true, staffProfileId: true, startAt: true, endAt: true, durationMinutes: true,
        appointments: { where: { tenantId: actor.tenantId }, select: { id: true }, take: 2 } } } } })
  const owners = new Map(orders.flatMap(order => order.lines.map(line => [line.id, { order, line }] as const)))
  for (const { before, after } of linked) {
    const owner = owners.get(before.orderLineId!)
    if (!owner || owner.line.appointments.length !== 1 || owner.line.appointments[0].id !== before.id) {
      throw new BusinessError(409, "The linked booking needs review. Open the booking order before editing.")
    }
    if (after.customerId !== before.customerId || after.serviceId !== before.serviceId ||
      after.customerId !== owner.order.customerId || after.serviceId !== owner.line.serviceId) {
      throw new BusinessError(409, "Change the customer or service through the booking order.")
    }
    if (moved(before, after) && ["IN_PROGRESS", "COMPLETED", "NO_SHOW"].includes(before.status)) {
      throw new BusinessError(409, "Started or completed appointment details cannot be replaced.")
    }
    if (activeAppointmentStatuses.includes(after.status) && owner.order.status !== "CONFIRMED") {
      throw new BusinessError(409, "Confirm the booking order before activating its appointments.")
    }
  }
  const setting = linked.some(({ before, after }) => moved(before, after))
    ? await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }) : null
  for (const order of orders) {
    const updates = linked.filter(change => owners.get(change.before.orderLineId!)?.order.id === order.id)
    const snapshot = () => ({ status: order.status, appointmentDate: order.appointmentDate.toISOString(),
      appointmentStartAt: order.appointmentStartAt.toISOString(), lines: order.lines.map(line => ({ id: line.id,
        serviceId: line.serviceId, staffProfileId: line.staffProfileId, startAt: line.startAt, endAt: line.endAt, durationMinutes: line.durationMinutes })) })
    const before = snapshot()
    for (const change of updates.filter(({ before, after }) => moved(before, after))) {
      const line = owners.get(change.before.orderLineId!)!.line
      const data = { staffProfileId: change.after.staffProfileId, startAt: change.after.startAt, endAt: change.after.endAt,
        durationMinutes: (change.after.endAt.getTime() - change.after.startAt.getTime()) / 60000 }
      await tx.appointmentOrderLine.update({ where: { id: line.id, orderId: order.id, order: { tenantId: actor.tenantId } }, data })
      Object.assign(line, data)
    }
    if (updates.some(({ before, after }) => moved(before, after))) {
      order.appointmentStartAt = new Date(Math.min(...order.lines.map(line => line.startAt.getTime())))
      order.appointmentDate = new Date(wallTime(order.appointmentStartAt, setting?.timeZone ?? "UTC").slice(0, 10) + "T00:00:00Z")
    }
    // Touch even for status-only changes so an order edit prepared earlier cannot
    // overwrite intervening appointment work. Do not infer an aggregate order status.
    await tx.appointmentOrder.update({ where: { id: order.id, tenantId: actor.tenantId }, data: {
      appointmentDate: order.appointmentDate, appointmentStartAt: order.appointmentStartAt, updatedAt: new Date() } })
    await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role,
      requestId: actor.requestId, event: "appointments.order.appointments_updated", entityType: "order", entityId: order.id,
      before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(snapshot())),
      metadata: { officeId: order.officeId, officeFamily: "appointments", appointmentsBefore: updates.map(change => value(change.before)), appointmentsAfter: updates.map(change => value(change.after)) } })
  }
}
