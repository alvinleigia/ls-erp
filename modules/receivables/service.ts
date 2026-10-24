import { authorizeBusinessOperation } from "@/platform/access/operation"
import { recordActionAccess } from "@/platform/access/record-actions"

import { Prisma, type PrismaClient } from "@prisma/client"

import { requirePermission } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

import { serializationConflict } from "@/platform/database-errors"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { receivableOpenSchema, receivableListSchema, orderPaymentSchema, orderPaymentReversalSchema } from "@/lib/validation"
import type { ReceivableSource } from "./contracts"
import { readReceivableOverview } from "./overview"
type Tx = Prisma.TransactionClient
const D = Prisma.Decimal
const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null
const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
export function createReceivableService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, source: ReceivableSource) {
  async function run<T>(requirement: Requirement, write: boolean, fn: (tx: Tx, actor: BusinessActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const actor = await authorizeBusinessOperation(tx, identity, requirement, ["receivables"])
          requirePermission(actor, ["salesOrders.read", "receivables.read"])
          return fn(tx, actor)
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (e) {
        if ((serializationConflict(e) || (e as { code?: string }).code === "P2002") && attempt < 3) continue
        if (serializationConflict(e) || (e as { code?: string }).code === "P2002") throw new BusinessError(409, "The balance or payment reference changed. Refresh and try again.")
        throw e
      }
    }
  }
  async function find(tx: Tx, actor: BusinessActor, id: string, lock = false) {
    const where = { AND: [{ tenantId: actor.tenantId, id }, source.scope(actor)] }
    if (!await tx.salesOrder.findFirst({ where, select: { id: true } })) throw new BusinessError(404, "Sales order not found.")
    if (lock) await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
    return tx.salesOrder.findFirstOrThrow({ where })
  }
  async function today(tx: Tx, tenantId: string) {
    const settings = await tx.appSetting.findFirst({ where: { tenantId }, select: { timeZone: true } })
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: settings?.timeZone || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
    const value = (key: string) => parts.find(p => p.type === key)!.value
    return `${value("year")}-${value("month")}-${value("day")}`
  }
  async function audit(tx: Tx, actor: BusinessActor, orderId: string, event: string, after: Prisma.InputJsonObject) {
    await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, entityType: "OrderReceivable", entityId: orderId, event: `receivable.${event}`, after })
  }
  async function actorName(tx: Tx, actor: BusinessActor) {
    return (await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: actor.userId }, select: { name: true } })).name || "Staff"
  }
  async function balances(tx: Tx, tenantId: string, orderId: string) {
    const lines = await tx.orderReceivableLine.findMany({ where: { tenantId, orderId }, orderBy: { position: "asc" } })
    const paid = await tx.orderReceiptAllocation.groupBy({ by: ["lineId"], where: { tenantId, orderId, payment: { status: "POSTED" } }, _sum: { amount: true } })
    return lines.map(line => { const received = paid.find(p => p.lineId === line.id)?._sum.amount || new D(0); return { ...line, paid: received, outstanding: line.amount.minus(received) } })
  }
  async function accountForWrite(tx: Tx, tenantId: string, orderId: string, status: string, version: number) {
    if (status !== "CONFIRMED") throw new BusinessError(409, "Payments require a confirmed order.")
    const account = await tx.orderReceivable.findUnique({ where: { tenantId_orderId: { tenantId, orderId } } })
    if (!account) throw new BusinessError(409, "Open receivables before recording payments.")
    if (account.version !== version) throw new BusinessError(409, "This balance changed. Refresh before continuing.")
    return account
  }
  async function bump(tx: Tx, tenantId: string, orderId: string) {
    await tx.orderReceivable.update({ where: { tenantId_orderId: { tenantId, orderId } }, data: { version: { increment: 1 } } })
  }
  return {
    list(input: unknown) {
      const query = receivableListSchema.parse(input)
      return run("receivables.read", false, async (tx, actor) => readReceivableOverview(tx, actor.tenantId, source.visibleOrderIds(actor), await today(tx, actor.tenantId), query))
    },
    get(id: string, requestedPage = 1) {
      return run("receivables.read", false, async (tx, actor) => {
        const order = await find(tx, actor, id), tenantId = actor.tenantId, plan = source.plan(order.snapshot), currentDay = await today(tx, tenantId)
        const account = await tx.orderReceivable.findUnique({ where: { tenantId_orderId: { tenantId, orderId: id } } })
        const lines = account ? await balances(tx, tenantId, id) : []
        const rights = (resource: "receivables" | "orderPayments") => recordActionAccess(actor, resource, id, tx, async action => tx.salesOrder.findFirst({ where: { AND: [{ tenantId, id }, source.scope({ ...actor, operation: { resource, action } })] }, select: { id: true } }))
        const [receivableAccess, paymentAccess] = await Promise.all([rights("receivables"), rights("orderPayments")])
        const recordAccess = { resource: "receivables" as const, id, permissions: { ...receivableAccess.permissions, ...paymentAccess.permissions } }
        const canReadPayments = !!paymentAccess.permissions["orderPayments.read"], active = order.status === "CONFIRMED"
        const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000000) : 1, pageSize = 10
        const where = { tenantId, orderId: id }
        const items = account && canReadPayments ? await tx.orderReceipt.findMany({ where, include: { reversal: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }) : []
        const total = account && canReadPayments ? await tx.orderReceipt.count({ where }) : 0
        const paid = lines.reduce((n, l) => n.plus(l.paid), new D(0)), outstanding = active && account ? account.total.minus(paid) : new D(0)
        const overdue = active ? lines.filter(l => l.dueOn && iso(l.dueOn)! < currentDay).reduce((n, l) => n.plus(l.outstanding), new D(0)) : new D(0)
        return { account, currency: order.currency, status: order.status, today: currentDay, plan, lines, paid, outstanding, overdue, items, total, page, pageSize, canReadPayments, recordAccess,
          canOpen: active && !account && !plan.blocked && !!receivableAccess.permissions["receivables.create"],
          canRecord: active && !!account && outstanding.gt(0) && canReadPayments && !!paymentAccess.permissions["orderPayments.create"],
          canReverse: active && !!account && canReadPayments && !!paymentAccess.permissions["orderPayments.cancel"] }
      })
    },
    open(id: string, input: unknown) {
      const data = receivableOpenSchema.parse(input)
      return run("receivables.create", true, async (tx, actor) => {
        const order = await find(tx, actor, id, true), tenantId = actor.tenantId, plan = source.plan(order.snapshot)
        if (order.status !== "CONFIRMED" || plan.blocked) throw new BusinessError(409, plan.blocked || "Confirm the order before opening receivables.")
        if (data.dueDates.length !== plan.lines.length) throw new BusinessError(400, "Supply a due date or leave it blank for every schedule line.")
        const existing = await tx.orderReceivable.findUnique({ where: { tenantId_orderId: { tenantId, orderId: id } }, include: { lines: { orderBy: { position: "asc" } } } })
        if (existing) {
          if (existing.lines.some((l, i) => iso(l.dueOn) !== data.dueDates[i])) throw new BusinessError(409, "Receivables have already been opened with different dates.")
          return existing
        }
        const row = await tx.orderReceivable.create({ data: { tenantId, orderId: id, currency: order.currency, total: plan.total, createdBy: actor.userId, actorName: await actorName(tx, actor) } })
        for (const [position, line] of plan.lines.entries()) await tx.orderReceivableLine.create({ data: { tenantId, orderId: id, position, label: line.label, amount: line.amount, dueOn: data.dueDates[position] ? date(data.dueDates[position]!) : null } })
        await audit(tx, actor, id, "opened", { total: plan.total, currency: order.currency, dueDates: data.dueDates })
        return row
      })
    },
    record(id: string, input: unknown) {
      const data = orderPaymentSchema.parse(input)
      return run(["orderPayments.read", "orderPayments.create"], true, async (tx, actor) => {
        const order = await find(tx, actor, id, true), tenantId = actor.tenantId, amount = new D(data.amount)
        const existing = await tx.orderReceipt.findUnique({ where: { tenantId_requestKey: { tenantId, requestKey: data.requestKey } } })
        if (existing) {
          if (existing.orderId !== id || !existing.amount.eq(amount) || iso(existing.receivedOn) !== data.receivedOn || existing.method !== data.method || existing.reference !== data.reference || existing.note !== data.note) throw new BusinessError(409, "This request was already used for a different payment.")
          return existing
        }
        const account = await accountForWrite(tx, tenantId, id, order.status, data.version)
        const digits = new Intl.NumberFormat("en", { style: "currency", currency: account.currency }).resolvedOptions().maximumFractionDigits ?? 2
        if (!amount.gt(0) || amount.decimalPlaces() > digits) throw new BusinessError(400, `Enter a positive amount with at most ${digits} decimal places.`)
        if (data.receivedOn > await today(tx, tenantId)) throw new BusinessError(400, "Payment date cannot be in the future.")
        const referenceKey = data.reference.toLowerCase()
        if (referenceKey && await tx.orderReceipt.count({ where: { tenantId, method: data.method, referenceKey, status: "POSTED" } })) throw new BusinessError(409, "This payment reference has already been recorded.")
        const lines = (await balances(tx, tenantId, id)).sort((a, b) => (iso(a.dueOn) || "9999").localeCompare(iso(b.dueOn) || "9999") || a.position - b.position)
        if (amount.gt(lines.reduce((n, l) => n.plus(l.outstanding), new D(0)))) throw new BusinessError(409, "Payment exceeds the outstanding balance.")
        const row = await tx.orderReceipt.create({ data: { tenantId, orderId: id, requestKey: data.requestKey, amount, receivedOn: date(data.receivedOn), method: data.method, reference: data.reference, referenceKey, note: data.note, createdBy: actor.userId, actorName: await actorName(tx, actor) } })
        let remaining = amount
        for (const line of lines) {
          const allocated = D.min(remaining, line.outstanding)
          if (allocated.gt(0)) { await tx.orderReceiptAllocation.create({ data: { tenantId, orderId: id, paymentId: row.id, lineId: line.id, amount: allocated } }); remaining = remaining.minus(allocated) }
        }
        await bump(tx, tenantId, id)
        await audit(tx, actor, id, "payment.recorded", { paymentId: row.id, amount: amount.toString(), method: data.method, reference: data.reference, receivedOn: data.receivedOn })
        return row
      })
    },
    reverse(id: string, paymentId: string, input: unknown) {
      const data = orderPaymentReversalSchema.parse(input)
      return run(["orderPayments.read", "orderPayments.cancel"], true, async (tx, actor) => {
        const order = await find(tx, actor, id, true), tenantId = actor.tenantId
        const existing = await tx.orderReceiptReversal.findUnique({ where: { tenantId_requestKey: { tenantId, requestKey: data.requestKey } } })
        if (existing) {
          if (existing.orderId !== id || existing.paymentId !== paymentId || existing.kind !== data.kind || existing.reason !== data.reason || existing.reference !== data.reference || iso(existing.effectiveOn) !== data.effectiveOn) throw new BusinessError(409, "This request was already used for a different reversal.")
          return existing
        }
        await accountForWrite(tx, tenantId, id, order.status, data.version)
        const receipt = await tx.orderReceipt.findFirst({ where: { tenantId, orderId: id, id: paymentId } })
        if (!receipt) throw new BusinessError(404, "Payment not found.")
        if (receipt.status !== "POSTED") throw new BusinessError(409, "This payment has already been reversed.")
        if (data.effectiveOn < iso(receipt.receivedOn)! || data.effectiveOn > await today(tx, tenantId)) throw new BusinessError(400, "Reversal date must be between the payment date and today.")
        const row = await tx.orderReceiptReversal.create({ data: { tenantId, orderId: id, paymentId, requestKey: data.requestKey, kind: data.kind, reason: data.reason, effectiveOn: date(data.effectiveOn), reference: data.reference, createdBy: actor.userId, actorName: await actorName(tx, actor) } })
        await tx.orderReceipt.update({ where: { tenantId_id: { tenantId, id: paymentId } }, data: { status: "REVERSED" } })
        await bump(tx, tenantId, id)
        await audit(tx, actor, id, data.kind === "REFUND" ? "payment.refunded" : "payment.corrected", { paymentId, amount: receipt.amount.toString(), reason: data.reason, reference: data.reference, effectiveOn: data.effectiveOn })
        return row
      })
    },
  }
}
