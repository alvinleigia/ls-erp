import { taxPreparationError } from "@/platform/tax/source-errors"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { businessDate } from "@/lib/business-time"
import { officeBoundaryError } from "@/platform/companies/record-office"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { recordActionAccess } from "@/platform/access/record-actions"

import type { Prisma, PrismaClient } from "@prisma/client"


import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

import { serializationConflict } from "@/platform/database-errors"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { salesOrderCreateSchema, salesOrderSourceSchema, salesOrderListSchema, salesOrderTransitionSchema } from "@/lib/validation"
import type { SalesOrderSource } from "./contracts"
type Tx = Prisma.TransactionClient
const listSelect = { id: true, reference: true, orderedOn: true, title: true, customerName: true, currency: true, consideration: true, quotationId: true, revision: true, status: true, version: true, createdAt: true } as const

export function createSalesOrderService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, source: SalesOrderSource) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>, write = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          if (write) {
            await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR SHARE`
            await lockTenantOperations(tx, identity.tenantId)
          }
          const actor = await authorizeBusinessOperation(tx, identity, requirement, ["salesOrders"])
          return operation(tx, actor)
        }, { isolationLevel: write ? "ReadCommitted" : "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (e) {
        const officeError = officeBoundaryError(e); if (officeError) throw officeError
        const taxError=taxPreparationError(e);if(taxError)throw taxError
        if ((serializationConflict(e) || (e as { code?: string }).code === "P2002") && attempt < 3) continue
        if (serializationConflict(e) || (e as { code?: string }).code === "P2002") throw new BusinessError(409, "This order changed. Refresh and try again.")
        throw e
      }
    }
  }
  const scope = (actor: BusinessActor): Prisma.SalesOrderWhereInput => ({ AND: [{ tenantId: actor.tenantId }, source.scope(actor)] })
  async function find(tx: Tx, actor: BusinessActor, id: string) {
    const row = await tx.salesOrder.findFirst({ where: { AND: [scope(actor), { id }] } })
    if (!row) throw new BusinessError(404, "Sales order not found.")
    return row
  }
  async function today(tx: Tx, tenantId: string) {
    const settings = await tx.appSetting.findFirst({ where: { tenantId }, select: { timeZone: true } })
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    return businessDate(now, settings?.timeZone || "UTC")
  }
  async function event(tx: Tx, actor: BusinessActor, row: { id: string; status: string; version: number; reference: string | null; orderedOn: Date | null }, previous?: string, reason = "") {
    const user = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: actor.userId }, select: { name: true } })
    await tx.salesOrderEvent.create({ data: { tenantId: actor.tenantId, orderId: row.id, version: row.version, status: row.status, actorId: actor.userId, actorName: user.name || "Staff", reason } })
    await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, entityType: "SalesOrder", entityId: row.id, event: `salesOrder.${row.status.toLowerCase()}`, before: previous ? { status: previous } : undefined, after: { status: row.status, version: row.version, reference: row.reference, orderedOn: row.orderedOn?.toISOString().slice(0, 10) ?? null, reason } })
  }
  return {
    prepareCreate(input: unknown) {
      const data = salesOrderSourceSchema.parse(input)
      return run(["salesOrders.read", "salesOrders.create", "quotations.read"], async (tx, actor) => {
        const selected = await source.read(tx, actor, data.quotationId, data.revision)
        const existing = await tx.salesOrder.findFirst({ where: { AND: [scope(actor), { quotationId: data.quotationId, status: { not: "CANCELLED" } }] }, select: { id: true, reference: true, revision: true, orderedOn: true } })
        return { quotationId: selected.quotationId, revision: selected.revision, title: selected.title, customerName: selected.customerName, currency: selected.currency, consideration: selected.consideration, orderedOn: await today(tx, actor.tenantId), existing }
      })
    },
    list(input: unknown) {
      const q = salesOrderListSchema.parse(input)
      return run("salesOrders.read", async (tx, actor) => {
        const where: Prisma.SalesOrderWhereInput = { AND: [scope(actor), { ...(q.status ? { status: q.status } : {}), OR: [{ reference: { contains: q.q, mode: "insensitive" } }, { title: { contains: q.q, mode: "insensitive" } }, { customerName: { contains: q.q, mode: "insensitive" } }, { id: { contains: q.q, mode: "insensitive" } }] }] }
        const [items, total] = await Promise.all([tx.salesOrder.findMany({ where, select: listSelect, orderBy: [{ [q.sort]: q.order }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.salesOrder.count({ where })])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    get(id: string) {
      return run("salesOrders.read", async (tx, actor) => {
        const row = await find(tx, actor, id)
        const recordAccess = await recordActionAccess(actor, "salesOrders", id, tx, async action => tx.salesOrder.findFirst({ where: { AND: [scope({ ...actor, operation: { resource: "salesOrders", action } }), { id }] }, select: { id: true } }))
        const history = await tx.salesOrderEvent.findMany({ where: { tenantId: actor.tenantId, orderId: id }, orderBy: { version: "asc" } })
        const canConfirm = row.status === "DRAFT" && !!recordAccess.permissions["salesOrders.confirm"]
        const confirmationReview = canConfirm ? await source.reviewConfirmation?.(tx, actor, row.snapshot) : undefined
        return { ...row, history, recordAccess, confirmationReview, canConfirm, canCancel: row.status !== "CANCELLED" && !!recordAccess.permissions["salesOrders.cancel"] }
      })
    },
    create(input: unknown) {
      const data = salesOrderCreateSchema.parse(input)
      return run(["salesOrders.read", "salesOrders.create", "quotations.read"], async (tx, actor) => {
        // Source authorizes record access before locking. Lock the quotation header
        // to serialize creation across all revisions, including replacements.
        const selected = await source.read(tx, actor, data.quotationId, data.revision)
        await tx.$queryRaw`SELECT id FROM "CrmQuotation" WHERE "tenantId"=${actor.tenantId} AND id=${data.quotationId} FOR UPDATE`
        const existing = await tx.salesOrder.findFirst({ where: { tenantId: actor.tenantId, quotationId: data.quotationId, status: { not: "CANCELLED" } }, select: listSelect })
        if (existing) {
          if (existing.revision !== data.revision) throw new BusinessError(409, "An active order already uses another revision. Cancel it before creating a replacement.")
          if (data.orderedOn && existing.orderedOn?.toISOString().slice(0, 10) !== data.orderedOn) throw new BusinessError(409, "The existing order has another date. Open it to review; cancel and replace it to change saved terms.")
          return existing
        }
        const currentDate = await today(tx, actor.tenantId), orderedOn = data.orderedOn ?? currentDate
        if (orderedOn > currentDate || orderedOn < "0001-01-01") throw new BusinessError(400, "Choose an order date on or before today in the tenant time zone.")
        const row = await tx.salesOrder.create({ data: { ...selected, orderedOn: new Date(`${orderedOn}T00:00:00Z`), tenantId: actor.tenantId, createdBy: actor.userId }, select: listSelect })
        await event(tx, actor, row)
        return row
      }, true)
    },
    transition(id: string, input: unknown) {
      const data = salesOrderTransitionSchema.parse(input)
      return run(["salesOrders.read", `salesOrders.${data.action}`], async (tx, actor) => {
        await find(tx, actor, id)
        await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
        const before = await find(tx, actor, id)
        if (before.version !== data.version) throw new BusinessError(409, "This order changed. Refresh before continuing.")
        if (before.status === "CANCELLED" || (data.action === "confirm" && before.status !== "DRAFT")) throw new BusinessError(409, "This order cannot make that transition.")
        const participantAcceptance = data.action === "confirm" ? await source.onConfirm(tx, actor, before.snapshot) : undefined
        if (data.action === "cancel") await source.onCancel?.(tx, actor, id, data.reason)
        const row = await tx.salesOrder.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data: { participantAcceptance, status: data.action === "confirm" ? "CONFIRMED" : "CANCELLED", version: { increment: 1 } }, select: listSelect })
        await event(tx, actor, row, before.status, data.action === "cancel" ? data.reason : "")
        return row
      }, true)
    },
  }
}
