import type { Prisma } from "@prisma/client"

// Availability remains enforced even when the optional order module is disabled.
// Time-based holds stop blocking immediately; no scheduler is required.
export const activeReservation = (now: Date): Prisma.UnitReservationWhereInput => ({ OR: [{ status: "ALLOCATED" }, { status: "HELD", expiresAt: { gt: now } }] })
export async function reservationClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  return row.now
}
export async function reservedUnits(tx: Prisma.TransactionClient, tenantId: string, ids: string[], now: Date) {
  const rows = await tx.unitReservation.findMany({ where: { tenantId, itemId: { in: ids }, ...activeReservation(now) }, select: { itemId: true, status: true } })
  return new Map(rows.map(row => [row.itemId, row.status === "HELD" ? "RESERVED" : "ALLOCATED"]))
}
