import { authorizeBusinessOperation } from "@/platform/access/operation"

import { Prisma, type PrismaClient } from "@prisma/client"

import { requireWriteFields, permits } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { catalogItemSchema, catalogListSchema } from "./validation"
import type { CatalogExtension } from "./contracts"
import { serializationConflict } from "@/platform/database-errors"
import { activeReservation, reservationClock, reservedUnits } from "./reservation-availability"
type Tx = Prisma.TransactionClient
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))

export async function catalogScope(tx: Tx, actor: BusinessActor, extensions: readonly CatalogExtension[], filter?: { extensionKey?: string; contextId?: string }) {
  const scopes: Prisma.CatalogItemWhereInput[] = filter?.extensionKey ? [] : [{ extensionKey: null }]
  for (const extension of extensions) {
    if (filter?.extensionKey && filter.extensionKey !== extension.key) continue
    const scope = await extension.scope(tx, actor, filter?.contextId)
    if (scope) scopes.push({ AND: [{ extensionKey: extension.key }, scope] })
  }
  return { tenantId: actor.tenantId, OR: scopes }
}
export function createCatalogService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, extensions: readonly CatalogExtension[] = []) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const actor = await authorizeBusinessOperation(tx, identity, requirement, ["catalog"])
          return operation(tx, actor)
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (e) {
        if (serializationConflict(e) && attempt < 2) continue
        if (serializationConflict(e)) throw new BusinessError(409, "This item changed. Refresh before saving.")
        if ((e as { code?: string }).code === "P2002") throw new BusinessError(409, "This item code is already used in this business.")
        throw e
      }
    }
  }
  async function find(tx: Tx, actor: BusinessActor, id: string) {
    const row = await tx.catalogItem.findFirst({ where: { AND: [await catalogScope(tx, actor, extensions), { id }] } })
    if (!row) throw new BusinessError(404, "Catalog item not found.")
    return row
  }
  return {
    list(input: unknown) {
      const q = catalogListSchema.parse(input)
      return run("catalogItems.read", async (tx, actor) => {
        const now = await reservationClock(tx), active = activeReservation(now)
        const availability: Prisma.CatalogItemWhereInput = q.availability === "RESERVED" ? { reservationAvailability: { is: { status: "HELD", expiresAt: { gt: now } } } } : q.availability === "ALLOCATED" ? { reservationAvailability: { is: { status: "ALLOCATED" } } } : q.availability ? { availability: q.availability, reservationAvailability: { isNot: active } } : {}
        const where: Prisma.CatalogItemWhereInput = { AND: [await catalogScope(tx, actor, extensions, q), availability, { archived: q.archived === "true", ...(q.currency ? {currency:q.currency} : {}), ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" } }, { name: { contains: q.q, mode: "insensitive" } }] } : {}) }] }
        const [items, total] = await Promise.all([tx.catalogItem.findMany({ where, select: { id: true, code: true, name: true, kind: true, unit: true, price: true, currency: true, availability: true, archived: true, version: true, extensionKey: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.catalogItem.count({ where })])
        const occupied = await reservedUnits(tx, actor.tenantId, items.map(i => i.id), now)
        return { items: items.map(row => ({ ...row, reservationState: occupied.get(row.id) || null })), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), canCreate: permits(actor, "catalogItems.create") }
      })
    },
    get(id: string) {
      return run("catalogItems.read", async (tx, actor) => {
        const row = await find(tx, actor, id)
        const extension = extensions.find(e => e.key === row.extensionKey)
        const reservationState = (await reservedUnits(tx, actor.tenantId, [id], await reservationClock(tx))).get(id) || null
        return { ...row, reservationState, extension: extension ? await extension.read(tx, actor, id) : null, canManage: !reservationState && permits(actor, "catalogItems.edit") }
      })
    },
    save(input: unknown, id?: string) {
      const data = catalogItemSchema.parse(input)
      return run(id ? "catalogItems.edit" : "catalogItems.create", async (tx, actor) => {
        if (id) {
          await find(tx, actor, id)
          await tx.$queryRaw`SELECT id FROM "CatalogItem" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
          if ((await reservedUnits(tx, actor.tenantId, [id], await reservationClock(tx))).has(id)) throw new BusinessError(409, "Release the unit reservation before changing this catalog item.")
        }
        const before = id ? await find(tx, actor, id) : null
        requireWriteFields(actor, "catalogItems", before ?? undefined, data)
        if (before && (data.version !== before.version || data.kind !== before.kind || data.extensionKey !== before.extensionKey)) throw new BusinessError(409, "Refresh this item. Its kind and extension cannot be changed after creation.")
        const extension = data.extensionKey ? extensions.find(e => e.key === data.extensionKey) : undefined
        if (data.extensionKey && !extension) throw new BusinessError(400, "Unknown catalog extension.")
        if (extension && !(await extension.scope(tx, actor))) throw new BusinessError(403, "This item extension is not available to your account.")
        if (extension && data.kind !== "UNIT") throw new BusinessError(400, "Property details require an individually identified unit.")
        const { version: _version, extension: _extension, ...fields } = data
        void _version; void _extension
        const values = { ...fields, price: new Prisma.Decimal(data.price) }
        if (id) {
          const changed = await tx.catalogItem.updateMany({ where: { tenantId: actor.tenantId, id, version: data.version }, data: { ...values, version: { increment: 1 } } })
          if (!changed.count) throw new BusinessError(409, "This item changed. Refresh before saving.")
        }
        const row = id ? await tx.catalogItem.findUniqueOrThrow({ where: { tenantId_id: { tenantId: actor.tenantId, id } } }) : await tx.catalogItem.create({ data: { ...values, tenantId: actor.tenantId } })
        const previousExtension = before && extension ? await extension.read(tx, actor, row.id) : null
        if (extension) await extension.save(tx, actor, row.id, data.extension)
        const nextExtension = extension ? await extension.read(tx, actor, row.id) : null
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, entityType: "CatalogItem", entityId: row.id, event: id ? "catalog.item.updated" : "catalog.item.created", before: before ? json({ ...before, extension: previousExtension }) : undefined, after: json({ ...row, extension: nextExtension }) })
        return row
      })
    },
  }
}
