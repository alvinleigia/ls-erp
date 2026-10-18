import type { Prisma } from "@prisma/client"
import { AppointmentStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { AppointmentOrderCreateInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { appointmentTransaction } from "./appointment-transaction"
import { StockConflictError } from "@/modules/inventory/stock-service"
import { appointmentOrderInclude, serializeAppointmentOrder, orderLineData, orderProductLineData } from "./order-record"
import { resolveOrderData, type ResolvedOrderLine } from "./order-resolution"
import { scheduleConfirmedOrderLines } from "./order-scheduling"
import { assertAppointmentMovesAvailable } from "./appointment-conflicts"
import { applyStockDelta, buildStockDeltaForOrderUpdate } from "./order-stock"
import type { OrderListInput } from "./order-validation"

export async function listOrders(tenantId: string, input: OrderListInput) {
  const { page, pageSize, status, customerId } = input
  const where: Prisma.AppointmentOrderWhereInput = { tenantId, status, ...(customerId ? { customerId } : {}) }
  const [total, rows] = await prisma.$transaction([
    prisma.appointmentOrder.count({ where }),
    prisma.appointmentOrder.findMany({ where, include: appointmentOrderInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { items: rows.map(serializeAppointmentOrder), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function createOrder(actor: BusinessActor, input: AppointmentOrderCreateInput) {
  const { tenantId } = actor
  // Searching for a suggested slot can scan many days. Keep that outside the write lock.
  let planned: ResolvedOrderLine[] | null = null
  if (input.status === "CONFIRMED") {
    const preflight = await resolveOrderData(input, { actor, tenantId, enforceFutureStartAt: true })
    planned = await scheduleConfirmedOrderLines(preflight.lines, preflight.customerId, [], tenantId)
  }
  try {
    const order = await appointmentTransaction(actor, "create", async (tx, actor) => {
      if (input.status === "CANCELED") requirePermission(actor, "appointments.archive")
      // Re-read participants, catalog prices and coupon usage after acquiring the scheduling lock.
      const resolved = await resolveOrderData(input, { actor, tenantId, enforceFutureStartAt: true, db: tx })
      const scheduledLines = resolved.lines.map((line, index) => {
        if (!planned) return line
        const slot = planned[index]
        if (!slot || slot.serviceId !== line.serviceId || slot.staffProfileId !== line.staffProfileId ||
          slot.durationMinutes !== line.durationMinutes) {
          throw new BusinessError(409, "Booking details changed. Refresh before saving.")
        }
        return { ...line, startAt: slot.startAt, endAt: slot.endAt }
      })
      if (planned) await assertAppointmentMovesAvailable(tx, tenantId,
        scheduledLines.map(line => ({ ...line, id: `line ${line.sortOrder + 1}`, customerId: resolved.customerId,
          status: AppointmentStatus.SCHEDULED })), [])
      const created = await tx.appointmentOrder.create({
        data: {
          tenantId,
          customerId: resolved.customerId,
          appointmentDate: resolved.appointmentDate,
          appointmentStartAt: resolved.appointmentStartAt,
          status: resolved.status,
          customerNote: resolved.customerNote,
          internalNote: resolved.internalNote,
          subtotalCents: resolved.totals.subtotalCents,
          lineDiscountCents: resolved.totals.lineDiscountCents,
          couponDiscountCents: resolved.totals.couponDiscountCents,
          taxCents: resolved.totals.taxCents,
          totalCents: resolved.totals.totalCents,
          lines: {
            create: scheduledLines.map(orderLineData)
          },
          productLines: {
            create: resolved.productLines.map(orderProductLineData)
          },
          coupons: {
            create: resolved.coupons.map((coupon) => ({
              code: coupon.code,
              discountType: coupon.discountType,
              discountValue: coupon.discountValue,
              discountCents: coupon.discountCents,
            })),
          },
          taxes: {
            create: resolved.taxes.map((tax) => ({
              taxId: tax.taxId,
              name: tax.name,
              percent: tax.percent,
              taxCents: tax.taxCents,
            })),
          },
        },
        include: appointmentOrderInclude,
      })

      if (resolved.status === "CONFIRMED") {
        const createdLineBySortOrder = new Map(
          created.lines.map((line) => [line.sortOrder, line])
        )
        await tx.appointment.createMany({
          data: scheduledLines
            .map((line) => {
              const createdLine = createdLineBySortOrder.get(line.sortOrder)
              if (!createdLine) throw new Error("Created booking line is missing.")
              return {
                tenantId,
                staffProfileId: line.staffProfileId,
                customerId: created.customerId,
                serviceId: line.serviceId,
                startAt: line.startAt,
                endAt: line.endAt,
                status: AppointmentStatus.SCHEDULED,
                orderLineId: createdLine.id,
              }
            })
        })
      }

      const stockDelta = buildStockDeltaForOrderUpdate({
        previousStatus: "DRAFT",
        nextStatus: resolved.status,
        previousLines: [],
        nextLines: resolved.productLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
      })
      await applyStockDelta({
        actor,
        tx,
        deltaByProduct: stockDelta,
        orderId: created.id,
        tenantId,
      })

      await recordDomainAuditEvent(tx, {
        tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: "appointments.order.create", entityType: "order", entityId: created.id,
        after: JSON.parse(JSON.stringify(created)),
      })
      return created
    })
    return { order: serializeAppointmentOrder(order) }
  } catch (error) {
    if (error instanceof StockConflictError) throw new BusinessError(409, error.message)
    throw error
  }
}
