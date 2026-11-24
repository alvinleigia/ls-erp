import { authorizeBusinessOperation } from "@/platform/access/operation"

import { Prisma, type PrismaClient } from "@prisma/client"

import { permits } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { catalogListSchema } from "./validation"
import type { CatalogExtension } from "./contracts"
import { serializationConflict } from "@/platform/database-errors"
import { activeReservation, reservationClock, reservedUnits } from "./reservation-availability"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { reservationBlocks } from "./reservation-blocks"
import { catalogPresentation } from "./presentation"
type Tx = Prisma.TransactionClient


export { catalogScope } from "./scope"
import { catalogScope } from "./scope"
import { findCatalogItem, saveCatalogItem } from "./mutations"
import { createCatalogImportService } from "./import-service"
import { basicCatalogImportProfile, type CatalogImportProfile } from "./import-template"
export function createCatalogService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, extensions: readonly CatalogExtension[] = [], importProfiles: readonly CatalogImportProfile[] = [basicCatalogImportProfile]) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>, write = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          if (write) { await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`; await lockTenantOperations(tx, identity.tenantId) }
          const actor = await authorizeBusinessOperation(tx, identity, requirement, ["catalog"])
          return operation(tx, actor)
        }, { isolationLevel: write ? "ReadCommitted" : "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (e) {
        if (serializationConflict(e) && attempt < 2) continue
        if (serializationConflict(e)) throw new BusinessError(409, "This item changed. Refresh before saving.")
        if ((e as { code?: string }).code === "P2002") throw new BusinessError(409, "This item reference, unit number or unit code is already used in the same context.")
        throw e
      }
    }
  }
  return {
    ...createCatalogImportService(run, extensions, importProfiles),
    list(input: unknown) {
      const q = catalogListSchema.parse(input)
      return run("catalogItems.read", async (tx, actor) => {
        const now = await reservationClock(tx), active = activeReservation(now)
        const availability: Prisma.CatalogItemWhereInput = q.availability === "RESERVED" ? { reservationAvailability: { is: { status: "HELD", expiresAt: { gt: now } } } } : q.availability === "ALLOCATED" ? { reservationAvailability: { is: { status: "ALLOCATED" } } } : q.availability ? { availability: q.availability, reservationAvailability: { isNot: active } } : {}
        const where: Prisma.CatalogItemWhereInput = { AND: [await catalogScope(tx, actor, extensions, q), availability, { archived: q.archived === "true", ...(q.currency ? {currency:q.currency} : {}), ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" } }, { name: { contains: q.q, mode: "insensitive" } }, ...extensions.flatMap(extension => extension.search ? [extension.search(q.q)] : [])] } : {}) }] }
        const [items, total] = await Promise.all([tx.catalogItem.findMany({ where, select: { id: true, code: true, name: true, kind: true, unit: true, price: true, currency: true, availability: true, archived: true, version: true, extensionKey: true }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), tx.catalogItem.count({ where })])
        const occupied = await reservedUnits(tx, actor.tenantId, items.map(i => i.id), now)
        const blocked = await reservationBlocks(tx, actor, extensions, items)
        const display = await catalogPresentation(tx, actor, extensions, items)
        return { items: items.map(row => ({ ...row, ...display.get(row.id), reservationState: occupied.get(row.id) || null, reservationBlockedReason: blocked.get(row.id) || null })), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), canCreate: permits(actor, "catalogItems.create") }
      })
    },
    get(id: string) {
      return run("catalogItems.read", async (tx, actor) => {
        const row = await findCatalogItem(tx, actor, extensions, id)
        const extension = extensions.find(e => e.key === row.extensionKey)
        const reservationState = (await reservedUnits(tx, actor.tenantId, [id], await reservationClock(tx))).get(id) || null
        return { ...row, ...(await catalogPresentation(tx, actor, extensions, [row])).get(id), reservationState, reservationBlockedReason: (await reservationBlocks(tx, actor, extensions, [row])).get(id) || null, extension: extension ? await extension.read(tx, actor, id) : null, canManage: !reservationState && permits(actor, "catalogItems.edit") }
      })
    },
    save(input: unknown, id?: string) {
      return run(id ? "catalogItems.edit" : "catalogItems.create", (tx, actor) => saveCatalogItem(tx, actor, extensions, input, id).then(row => row!), true)
    },
  }
}
