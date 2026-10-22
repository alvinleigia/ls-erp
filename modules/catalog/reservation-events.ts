import type { Prisma, UnitReservation } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { reservationClock } from "./reservation-availability"

export async function reservationEvent(tx: Prisma.TransactionClient, actor: BusinessActor, row: UnitReservation, previous?: string, reason = "") {
  const user = await tx.user.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: actor.userId }, select: { name: true } })
  await tx.unitReservationEvent.create({ data: { tenantId: actor.tenantId, reservationId: row.id, version: row.version, status: row.status, actorId: actor.userId, actorName: user.name || "Staff", reason } })
  await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, entityType: "UnitReservation", entityId: row.id, event: `catalog.reservation.${row.status.toLowerCase()}`, before: previous ? { status: previous } : undefined, after: { status: row.status, version: row.version, orderId: row.orderId, itemId: row.itemId, expiresAt: row.expiresAt.toISOString(), reason } })
}

// The caller has authorized order cancellation and locked the order. Release all
// its units regardless of module visibility, atomically with cancellation/audit.
export async function releaseOrderReservations(tx: Prisma.TransactionClient, actor: BusinessActor, orderId: string, reason: string) {
  const rows = await tx.unitReservation.findMany({ where: { tenantId: actor.tenantId, orderId, status: { in: ["HELD", "ALLOCATED"] } }, orderBy: { itemId: "asc" } })
  for (const row of rows) {
    await tx.$queryRaw`SELECT id FROM "CatalogItem" WHERE "tenantId"=${actor.tenantId} AND id=${row.itemId} FOR UPDATE`
    const expired = row.status === "HELD" && row.expiresAt <= await reservationClock(tx)
    const next = await tx.unitReservation.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { status: expired ? "EXPIRED" : "RELEASED", version: { increment: 1 } } })
    await reservationEvent(tx, actor, next, row.status, reason)
  }
}
