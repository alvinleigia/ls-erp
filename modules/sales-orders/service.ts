import type { Prisma, PrismaClient } from "@prisma/client"
import { findAccessUser, accessContext } from "@/platform/access/server"
import { permits, requirePermission } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "@/platform/policy"
import { moduleEnabled } from "@/platform/modules"
import { serializationConflict } from "@/platform/database-errors"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { salesOrderCreateSchema, salesOrderListSchema, salesOrderTransitionSchema } from "@/lib/validation"
import type { SalesOrderSource } from "./contracts"
type Tx = Prisma.TransactionClient
const manager = (actor: BusinessActor) => ["ADMIN", "MANAGER"].includes(actor.role)
const listSelect = { id: true, title: true, customerName: true, currency: true, consideration: true, quotationId: true, revision: true, status: true, version: true, createdAt: true } as const

export function createSalesOrderService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, source: SalesOrderSource) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const user = await findAccessUser(tx, identity.tenantId, identity.userId)
          if (!user || !hasBusinessAccess(user.role) || user.tenant.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Business workspace access is not permitted.")
          if (!moduleEnabled(await tx.tenantModule.findMany({ where: { tenantId: identity.tenantId } }), "salesOrders")) throw new BusinessError(403, "Sales Orders is not enabled.")
          const actor = { ...identity, ...accessContext(user) }
          requirePermission(actor, requirement)
          return operation(tx, actor)
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (e) {
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
  async function event(tx: Tx, actor: BusinessActor, row: { id: string; status: string; version: number }, previous?: string, reason = "") {
    const user = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: actor.userId }, select: { name: true } })
    await tx.salesOrderEvent.create({ data: { tenantId: actor.tenantId, orderId: row.id, version: row.version, status: row.status, actorId: actor.userId, actorName: user.name || "Staff", reason } })
    await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, entityType: "SalesOrder", entityId: row.id, event: `salesOrder.${row.status.toLowerCase()}`, before: previous ? { status: previous } : undefined, after: { status: row.status, version: row.version, reason } })
  }
  return {
    list(input: unknown) {
      const q = salesOrderListSchema.parse(input)
      return run("salesOrders.read", async (tx, actor) => {
        const where: Prisma.SalesOrderWhereInput = { AND: [scope(actor), { ...(q.status ? { status: q.status } : {}), OR: [{ title: { contains: q.q, mode: "insensitive" } }, { customerName: { contains: q.q, mode: "insensitive" } }, { id: { contains: q.q, mode: "insensitive" } }] }] }
        const [items, total] = await Promise.all([tx.salesOrder.findMany({ where, select: listSelect, orderBy: [{ [q.sort]: q.order }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.salesOrder.count({ where })])
        return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
      })
    },
    get(id: string) {
      return run("salesOrders.read", async (tx, actor) => {
        const row = await find(tx, actor, id)
        const history = await tx.salesOrderEvent.findMany({ where: { tenantId: actor.tenantId, orderId: id }, orderBy: { version: "asc" } })
        return { ...row, history, canConfirm: manager(actor) && row.status === "DRAFT" && permits(actor, "salesOrders.confirm"), canCancel: manager(actor) && row.status !== "CANCELLED" && permits(actor, "salesOrders.cancel") }
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
          return existing
        }
        const row = await tx.salesOrder.create({ data: { ...selected, tenantId: actor.tenantId, createdBy: actor.userId }, select: listSelect })
        await event(tx, actor, row)
        return row
      })
    },
    transition(id: string, input: unknown) {
      const data = salesOrderTransitionSchema.parse(input)
      return run(["salesOrders.read", `salesOrders.${data.action}`], async (tx, actor) => {
        if (!manager(actor)) throw new BusinessError(403, "Only administrators and managers can confirm or cancel sales orders.")
        await find(tx, actor, id)
        await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
        const before = await find(tx, actor, id)
        if (before.version !== data.version) throw new BusinessError(409, "This order changed. Refresh before continuing.")
        if (before.status === "CANCELLED" || (data.action === "confirm" && before.status !== "DRAFT")) throw new BusinessError(409, "This order cannot make that transition.")
        if (data.action === "cancel") await source.onCancel?.(tx, actor, id, data.reason)
        const row = await tx.salesOrder.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data: { status: data.action === "confirm" ? "CONFIRMED" : "CANCELLED", version: { increment: 1 } }, select: listSelect })
        await event(tx, actor, row, before.status, data.action === "cancel" ? data.reason : "")
        return row
      })
    },
  }
}
