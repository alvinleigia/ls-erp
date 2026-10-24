import { authorizeBusinessOperation } from "@/platform/access/operation"
import { recordActionAccess } from "@/platform/access/record-actions"

import type { Prisma, PrismaClient } from "@prisma/client"

import { requirePermission } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

import { serializationConflict } from "@/platform/database-errors"
import { unitReservationCreateSchema, unitReservationTransitionSchema } from "@/lib/validation"
import { catalogScope } from "./service"
import type { CatalogExtension } from "./contracts"
import type { ReservationOrderSource } from "./reservation-contracts"
import { reservationClock, reservedUnits } from "./reservation-availability"
import { reservationEvent } from "./reservation-events"
type Tx = Prisma.TransactionClient

export function createReservationService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, source: ReservationOrderSource, extensions: readonly CatalogExtension[]) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const actor = await authorizeBusinessOperation(tx, identity, requirement, ["catalog","salesOrders"])
          requirePermission(actor, ["salesOrders.read", "catalogItems.read", "unitReservations.read", requirement])
          return operation(tx, actor)
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (e) {
        const conflict = serializationConflict(e) || (e as { code?: string }).code === "P2002"
        if (conflict && attempt < 3) continue
        if (conflict) throw new BusinessError(409, "This unit changed. Refresh and try again.")
        throw e
      }
    }
  }
  async function order(tx: Tx, actor: BusinessActor, id: string, lock = false) {
    await source.find(tx, actor, id)
    if (lock) await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE "tenantId"=${actor.tenantId} AND id=${id} FOR UPDATE`
    return source.find(tx, actor, id)
  }
  async function item(tx: Tx, actor: BusinessActor, id: string) {
    const row = await tx.catalogItem.findFirst({ where: { AND: [await catalogScope(tx, actor, extensions), { id }] } })
    if (!row) throw new BusinessError(404, "Catalog unit not found.")
    return row
  }
  return {
    list(orderId: string) {
      return run("unitReservations.read", async (tx, actor) => {
        const selected = await order(tx, actor, orderId), refs = source.units(selected)
        const recordAccess = await recordActionAccess(actor, "unitReservations", orderId, tx, action => source.find(tx, { ...actor, operation: { resource: "unitReservations", action } }, orderId))
        const visible = await tx.catalogItem.findMany({ where: { AND: [await catalogScope(tx, actor, extensions), { id: { in: refs.map(ref => ref.itemId) } }] }, select: { id: true, archived: true, availability: true, kind: true } })
        const now = await reservationClock(tx), occupied = await reservedUnits(tx, actor.tenantId, visible.map(v => v.id), now)
        // One order has a bounded quotation; history is paged separately below.
        return {
          units: refs.filter(ref => visible.some(v => v.id === ref.itemId)).map(ref => { const current = visible.find(v => v.id === ref.itemId)!; return { ...ref, available: !current.archived && current.kind === "UNIT" && current.availability === "AVAILABLE" && !occupied.has(ref.itemId) } }),
          recordAccess,
          canCreate: selected.status !== "CANCELLED" && !!recordAccess.permissions["unitReservations.create"],
          canAllocate: selected.status === "CONFIRMED" && !!recordAccess.permissions["unitReservations.confirm"],
          canRelease: selected.status !== "CANCELLED" && !!recordAccess.permissions["unitReservations.cancel"],
        }
      })
    },
    history(orderId: string, page = 1) {
      return run("unitReservations.read", async (tx, actor) => {
        await order(tx, actor, orderId)
        const where: Prisma.UnitReservationWhereInput = { tenantId: actor.tenantId, orderId, item: await catalogScope(tx, actor, extensions) }
        const now = await reservationClock(tx), pageSize = 10
        const [items, total] = await Promise.all([tx.unitReservation.findMany({ where, include: { events: { orderBy: { version: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }), tx.unitReservation.count({ where })])
        return { items: items.map(row => ({ ...row, status: row.status === "HELD" && row.expiresAt <= now ? "EXPIRED" : row.status })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
      })
    },
    create(orderId: string, input: unknown) {
      const data = unitReservationCreateSchema.parse(input)
      return run("unitReservations.create", async (tx, actor) => {
        const selected = await order(tx, actor, orderId, true)
        if (selected.status === "CANCELLED") throw new BusinessError(409, "This order is cancelled.")
        const ref = source.units(selected).find(ref => ref.itemId === data.itemId)
        if (!ref) throw new BusinessError(400, "Choose a unique unit from this order's saved quotation.")
        await item(tx, actor, data.itemId)
        await tx.$queryRaw`SELECT id FROM "CatalogItem" WHERE "tenantId"=${actor.tenantId} AND id=${data.itemId} FOR UPDATE`
        const current = await item(tx, actor, data.itemId), now = await reservationClock(tx), expiresAt = new Date(data.expiresAt)
        if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 30 * 86400000) throw new BusinessError(400, "Choose a future expiry within 30 days.")
        if (current.archived || current.kind !== "UNIT" || current.availability !== "AVAILABLE") throw new BusinessError(409, "This unit is unavailable.")
        await tx.$executeRaw`SELECT app.expire_item_reservations(${actor.tenantId},${data.itemId},${actor.requestId ?? null})`
        const existing = await tx.unitReservation.findFirst({ where: { tenantId: actor.tenantId, itemId: data.itemId, status: { in: ["HELD", "ALLOCATED"] } } })
        if (!existing && (await reservedUnits(tx, actor.tenantId, [data.itemId], now)).has(data.itemId)) throw new BusinessError(409, "This unit is already reserved or allocated.")
        if (existing) {
          if (existing.orderId === orderId) return existing
          throw new BusinessError(409, "This unit is already reserved or allocated.")
        }
        const row = await tx.unitReservation.create({ data: { tenantId: actor.tenantId, orderId, itemId: data.itemId, itemCode: ref.code, itemName: ref.name, expiresAt } })
        await reservationEvent(tx, actor, row)
        return row
      })
    },
    transition(orderId: string, id: string, input: unknown) {
      const data = unitReservationTransitionSchema.parse(input)
      return run(data.action === "allocate" ? "unitReservations.confirm" : "unitReservations.cancel", async (tx, actor) => {
        const selected = await order(tx, actor, orderId, true)
        const row = await tx.unitReservation.findFirst({ where: { tenantId: actor.tenantId, orderId, id } })
        if (!row) throw new BusinessError(404, "Reservation not found.")
        await item(tx, actor, row.itemId)
        await tx.$queryRaw`SELECT id FROM "CatalogItem" WHERE "tenantId"=${actor.tenantId} AND id=${row.itemId} FOR UPDATE`
        const now = await reservationClock(tx)
        if (row.version !== data.version || selected.status === "CANCELLED" || !["HELD", "ALLOCATED"].includes(row.status) || (row.status === "HELD" && row.expiresAt <= now)) throw new BusinessError(409, "This reservation changed or expired. Refresh before continuing.")
        if (data.action === "allocate" && (selected.status !== "CONFIRMED" || row.status !== "HELD")) throw new BusinessError(409, "Confirm the order before allocating an unexpired hold.")
        const next = await tx.unitReservation.update({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, data: { status: data.action === "allocate" ? "ALLOCATED" : "RELEASED", version: { increment: 1 } } })
        await reservationEvent(tx, actor, next, row.status, data.action === "release" ? data.reason : "")
        return next
      })
    },
  }
}
