import { savedBookingProducts } from "./saved-products"
import { bookingWriteOffice, bookingOfficeLabels } from "./office"
import type { Appointment, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { appointmentOrderCreateSchema, type AppointmentOrderCreateInput, type AppointmentOrderUpdateInput } from "@/lib/validation"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { appointmentTransaction } from "./appointment-transaction"
import { StockConflictError } from "@/modules/inventory/stock-service"
import { appointmentOrderInclude, serializeAppointmentOrder, orderLineData, orderProductLineData } from "./order-record"
import { wallTime } from "@/lib/business-time"
import { mergeOrderTime } from "./order-time"
import { resolveOrderData } from "./order-resolution"
import { scheduleConfirmedOrderLines } from "./order-scheduling"
import { activeAppointmentStatuses, assertAppointmentMovesAvailable } from "./appointment-conflicts"
import { applyStockDelta, buildStockDeltaForOrderUpdate } from "./order-stock"

type Order = Prisma.AppointmentOrderGetPayload<{ include: typeof appointmentOrderInclude }>
const stale = () => new BusinessError(409, "This booking order changed. Refresh before saving.")
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const auditValue = (value: unknown) => JSON.parse(JSON.stringify(value))

export async function readOrder(db: Prisma.TransactionClient, tenantId: string, id: string) {
  const order = await db.appointmentOrder.findFirst({ where: { tenantId, id }, include: {...appointmentOrderInclude,productLines:false} })
  if (!order) throw new BusinessError(404, "Appointment order not found.")
  return (await savedBookingProducts(db,tenantId,[order]))[0]
}
export async function getOrder(tenantId: string, id: string) {
  return { order: serializeAppointmentOrder((await bookingOfficeLabels(prisma, tenantId, [await readOrder(prisma, tenantId, id)]))[0]) }
}
const linkedAppointments = (db: Prisma.TransactionClient, tenantId: string, order: Order) => db.appointment.findMany({
  where: { tenantId, orderLineId: { in: order.lines.map(line => line.id) } }, orderBy: { id: "asc" },
})

function savedInput(order: Order, timeZone: string): AppointmentOrderCreateInput {
  return {
    customerId: order.customerId, appointmentDate: order.appointmentDate.toISOString().slice(0, 10),
    appointmentStartTime: wallTime(order.appointmentStartAt, timeZone).slice(11, 16),
    appointmentStartAt: order.appointmentStartAt.toISOString(), status: order.status,
    customerNote: order.customerNote ?? "", internalNote: order.internalNote ?? "",
    coupons: order.coupons.map(coupon => coupon.code),
    lines: order.lines.map(line => ({ id: line.id, serviceId: line.serviceId, staffId: line.staffProfile.user.id,
      quantity: line.quantity, durationMinutes: line.durationMinutes, unitPriceCents: line.unitPriceCents,
      discountType: line.discountType, discountValue: line.discountValue, taxMode: line.taxMode, taxIds: line.taxIds, note: line.note ?? "" })),
    productLines: order.productLines.map(line => ({ id: line.id, productId: line.productId, quantity: line.quantity,
      unitPriceCents: line.unitPriceCents, discountType: line.discountType, discountValue: line.discountValue,
      taxMode: line.taxMode, taxIds: line.taxIds, note: line.note ?? "" })),
  }
}
export function prepareOrderEdit(order: Order, patch: AppointmentOrderUpdateInput, timeZone: string) {
  const saved = savedInput(order, timeZone)
  const input = appointmentOrderCreateSchema.parse({ ...saved, ...patch, ...mergeOrderTime(saved, patch, timeZone) })
  for (const key of ["lines", "productLines"] as const) {
    const ids = input[key].flatMap(line => line.id ? [line.id] : [])
    if (new Set(ids).size !== ids.length || ids.some(id => !order[key].some(line => line.id === id))) {
      throw new BusinessError(400, "A booking line is duplicated or does not belong to this order.")
    }
  }
  const financial = (value: AppointmentOrderCreateInput) => ({ customerId: value.customerId, coupons: value.coupons,
    lines: value.lines.map(({ id, serviceId, quantity, unitPriceCents, discountType, discountValue, taxMode, taxIds }) =>
      ({ id, serviceId, quantity, unitPriceCents, discountType, discountValue, taxMode, taxIds })),
    products: value.productLines.map(({ id, productId, quantity, unitPriceCents, discountType, discountValue, taxMode, taxIds }) =>
      ({ id, productId, quantity, unitPriceCents, discountType, discountValue, taxMode, taxIds })),
  })
  const scheduling = (value: AppointmentOrderCreateInput) => ({ customerId: value.customerId,
    startAt: new Date(value.appointmentStartAt).toISOString(),
    lines: value.lines.map(({ id, serviceId, staffId, quantity }) => ({ id, serviceId, staffId, quantity })),
  })
  return { input, financialChanged: !same(financial(saved), financial(input)),
    scheduleChanged: !same(scheduling(saved), scheduling(input)), activation: input.status === "CONFIRMED" && order.status !== "CONFIRMED" }
}

export async function updateOrder(actor: BusinessActor, id: string, patch: AppointmentOrderUpdateInput) {
  const { tenantId } = actor
  const snapshot = await readOrder(prisma, tenantId, id)
  const beforeAppointments = await linkedAppointments(prisma, tenantId, snapshot)
  const settings = await prisma.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const timeZone = settings?.timeZone ?? "UTC"
  const initial = prepareOrderEdit(snapshot, patch, timeZone)
  if (initial.input.status !== snapshot.status && (initial.input.status === "CANCELED" || snapshot.status === "CANCELED")) requirePermission(actor, "appointments.archive")
  // Only a changed schedule needs a multi-day suggestion search, outside the lock.
  let planned: Awaited<ReturnType<typeof scheduleConfirmedOrderLines>> | null = null
  if (initial.input.status === "CONFIRMED" && initial.scheduleChanged) {
    const resolved = await resolveOrderData(initial.input, { actor, tenantId, existingOrderId: id, savedLines: snapshot.lines, savedTaxes: initial.financialChanged ? undefined : snapshot.taxes })
    await bookingWriteOffice(prisma, actor, snapshot.officeId)
    planned = await scheduleConfirmedOrderLines(resolved.lines, resolved.customerId, beforeAppointments.map(row => row.id), tenantId, snapshot.officeId)
  }
  try {
    return await appointmentTransaction(actor, "edit", async (tx, actor) => {
      const current = await readOrder(tx, tenantId, id)
      await bookingWriteOffice(tx, actor, current.officeId)
      const appointments = await linkedAppointments(tx, tenantId, current)
      const currentSettings = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
      if ((currentSettings?.timeZone ?? "UTC") !== timeZone) throw stale()
      const { input, financialChanged, scheduleChanged, activation } = prepareOrderEdit(current, patch, timeZone)
      const status = input.status ?? current.status
      if (status !== current.status && (status === "CANCELED" || current.status === "CANCELED")) requirePermission(actor, "appointments.archive")
      if (status === "DRAFT" && current.status !== "DRAFT") throw new BusinessError(400, "Confirmed/completed orders cannot be moved back to draft.")
      // Repeated status commands are idempotent even if another request just committed.
      if (Object.keys(patch).every(key => key === "status") && status === current.status) return { order: serializeAppointmentOrder(current) }
      if (current.updatedAt.getTime() !== snapshot.updatedAt.getTime() ||
        !same(appointments.map(row => [row.id, row.updatedAt]), beforeAppointments.map(row => [row.id, row.updatedAt]))) throw stale()
      const appointmentByLine = new Map<string, Appointment>()
      for (const row of appointments) {
        if (appointmentByLine.has(row.orderLineId!)) throw new BusinessError(409, "Multiple appointments are linked to a service line. Review the booking before editing.")
        appointmentByLine.set(row.orderLineId!, row)
      }
      const retainedIds = input.lines.flatMap(line => line.id ? [line.id] : [])
      if (appointments.some(row => !retainedIds.includes(row.orderLineId!))) throw new BusinessError(409, "Service lines with appointment history cannot be removed. Cancel the booking instead.")
      const resolve = financialChanged || scheduleChanged || activation
      const resolved = resolve ? await resolveOrderData(input, { actor, tenantId, existingOrderId: id, db: tx, savedLines: current.lines, savedTaxes: financialChanged ? undefined : current.taxes }) : null
      if (activation && resolved && resolved.coupons.length !== new Set(input.coupons.map(code => code.trim().toUpperCase())).size) {
        throw new BusinessError(400, "A saved coupon is no longer available. Review the booking discounts before confirming.")
      }
      const serviceData = input.lines.map((line, index) => {
        const old = current.lines.find(saved => saved.id === line.id)
        const calculated = resolved?.lines[index]
        let data = calculated ? orderLineData(calculated) : { ...orderLineData(old!), note: line.note?.trim() || null, sortOrder: index }
        if (!financialChanged && old) data = { ...data, unitPriceCents: old.unitPriceCents, discountType: old.discountType,
          discountValue: old.discountValue, taxMode: old.taxMode, taxIds: old.taxIds, lineSubtotalCents: old.lineSubtotalCents,
          lineDiscountCents: old.lineDiscountCents, lineTaxCents: old.lineTaxCents, lineTotalCents: old.lineTotalCents }
        const linked = old ? appointmentByLine.get(old.id) : undefined
        if (!scheduleChanged && old) data = { ...data, startAt: linked?.startAt ?? old.startAt, endAt: linked?.endAt ?? old.endAt,
          staffProfileId: linked?.staffProfileId ?? old.staffProfileId, serviceId: linked?.serviceId ?? old.serviceId,
          durationMinutes: linked ? (linked.endAt.getTime() - linked.startAt.getTime()) / 60000 : old.durationMinutes }
        if (planned) {
          const slot = planned[index]
          if (!slot || slot.serviceId !== data.serviceId || slot.staffProfileId !== data.staffProfileId || slot.durationMinutes !== data.durationMinutes) throw stale()
          data = { ...data, startAt: slot.startAt, endAt: slot.endAt }
        }
        return { id: old?.id, data, linked }
      })
      const moves = serviceData.flatMap(line => {
        const previous = line.linked
        let nextStatus = previous?.status ?? "SCHEDULED"
        if (status === "CANCELED" && previous && activeAppointmentStatuses.includes(previous.status)) nextStatus = "CANCELED"
        if (status === "COMPLETED" && previous && activeAppointmentStatuses.includes(previous.status)) nextStatus = "COMPLETED"
        if (activation && previous?.status === "CANCELED" && current.status === "CANCELED") nextStatus = "SCHEDULED"
        if (!previous && status !== "CONFIRMED") return []
        const data = { staffProfileId: line.data.staffProfileId, serviceId: line.data.serviceId, customerId: input.customerId,
          startAt: line.data.startAt, endAt: line.data.endAt, status: nextStatus }
        const changedSlot = previous && (previous.staffProfileId !== data.staffProfileId || previous.serviceId !== data.serviceId ||
          previous.customerId !== data.customerId || previous.startAt.getTime() !== data.startAt.getTime() || previous.endAt.getTime() !== data.endAt.getTime())
        if (previous && ["COMPLETED", "NO_SHOW", "IN_PROGRESS"].includes(previous.status) && changedSlot) {
          throw new BusinessError(409, "Started or completed appointment details cannot be replaced by an order edit.")
        }
        const changed = !previous || changedSlot || previous.status !== nextStatus
        if (!changed) return []
        if (activeAppointmentStatuses.includes(nextStatus) && (!previous || changedSlot || !activeAppointmentStatuses.includes(previous.status)) && data.startAt <= new Date()) {
          throw new BusinessError(400, "Cannot schedule or reactivate appointments in the past.")
        }
        return [{ id: previous?.id ?? `line ${line.data.sortOrder + 1}`, line, data }]
      })
      await assertAppointmentMovesAvailable(tx, tenantId, moves.map(move => ({ id: move.id, ...move.data })), moves.flatMap(move => move.line.linked ? [move.id] : []))
      const orderData: Prisma.AppointmentOrderUncheckedUpdateManyInput = { status, customerId: input.customerId,
        appointmentDate: new Date(`${input.appointmentDate}T00:00:00Z`), appointmentStartAt: new Date(input.appointmentStartAt),
        customerNote: input.customerNote?.trim() || null, internalNote: input.internalNote?.trim() || null,
        ...(financialChanged && resolved ? resolved.totals : {}) }
      const changed = await tx.appointmentOrder.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data: orderData })
      if (changed.count !== 1) throw stale()
      await tx.appointmentOrderLine.deleteMany({ where: { orderId: id, order: { tenantId }, id: { notIn: retainedIds } } })
      for (const line of serviceData) {
        if (line.id) await tx.appointmentOrderLine.update({ where: { id: line.id, orderId: id, order: { tenantId } }, data: line.data })
        else line.id = (await tx.appointmentOrderLine.create({ data: { orderId: id, ...line.data } })).id
      }
      for (const move of moves) {
        if (move.line.linked) await tx.appointment.update({ where: { id: move.id, tenantId }, data: move.data })
        else await tx.appointment.create({ data: { tenantId, orderLineId: move.line.id!, ...move.data } })
      }
      if (financialChanged && resolved) {
        const productIds = input.productLines.flatMap(line => line.id ? [line.id] : [])
        await tx.appointmentOrderProductLine.deleteMany({ where: { orderId: id, order: { tenantId }, id: { notIn: productIds } } })
        for (const [index, line] of resolved.productLines.entries()) {
          const lineId = input.productLines[index].id
          const data = orderProductLineData(line)
          if (lineId) await tx.appointmentOrderProductLine.update({ where: { id: lineId, orderId: id, order: { tenantId } }, data })
          else await tx.appointmentOrderProductLine.create({ data: { orderId: id, ...data } })
        }
        await tx.appointmentOrderCoupon.deleteMany({ where: { orderId: id, order: { tenantId } } })
        await tx.appointmentOrderCoupon.createMany({ data: resolved.coupons.map(coupon => ({ orderId: id, code: coupon.code,
          discountType: coupon.discountType, discountValue: coupon.discountValue, discountCents: coupon.discountCents })) })
        await tx.appointmentOrderTax.deleteMany({ where: { orderId: id, order: { tenantId } } })
        await tx.appointmentOrderTax.createMany({ data: resolved.taxes.map(tax => ({ orderId: id, ...tax })) })
      }
      if (!financialChanged && patch.productLines) {
        for (const line of input.productLines) await tx.appointmentOrderProductLine.update({
          where: { id: line.id!, orderId: id, order: { tenantId } }, data: { note: line.note?.trim() || null },
        })
      }
      const deltaByProduct = buildStockDeltaForOrderUpdate({ previousStatus: current.status, nextStatus: status,
        previousLines: current.productLines, nextLines: input.productLines })
      await applyStockDelta({ actor, tx, tenantId, orderId: id, deltaByProduct })
      const saved = await readOrder(tx, tenantId, id)
      await recordDomainAuditEvent(tx, { tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: "appointments.order.edit", entityType: "order", entityId: id, before: auditValue(current), after: auditValue(saved),
        metadata: { officeId: current.officeId, officeFamily: "appointments", appointmentsBefore: auditValue(appointments), appointmentsAfter: auditValue(await linkedAppointments(tx, tenantId, saved)) } })
      return { order: serializeAppointmentOrder((await bookingOfficeLabels(tx, tenantId, [saved]))[0]) }
    })
  } catch (error) {
    if (error instanceof StockConflictError) throw new BusinessError(409, error.message)
    throw error
  }
}
