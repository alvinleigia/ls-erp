import { prisma } from "@/lib/prisma"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { BusinessError } from "@/platform/policy"
import { officeAllowed } from "@/platform/companies/office-access"
import type { RecordOffice } from "@/types/companies"

export async function bookingWriteOffice(tx: Prisma.TransactionClient, actor: BusinessActor, source?: string) {
  const office = source ?? (await tx.$queryRaw<{ id: string }[]>`SELECT app.booking_creation_office(${actor.tenantId}) AS id`)[0]?.id
  if (!office || !await officeAllowed(tx, actor, office)) throw new BusinessError(403, "Booking office access is not permitted.")
  return office
}
export async function assertBookingTarget(tx: Prisma.TransactionClient, tenantId: string, officeId: string, staff: string, first: Date, last: Date) {
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.booking_assignment_allowed(${tenantId},${officeId},${staff},${first}::timestamptz,${last}::timestamptz) AS allowed`
  if (!row.allowed) throw new BusinessError(400, "Staff must cover the booking office and dates.")
}
export async function bookingOfficeLabels<T extends { officeId: string }>(tx: Prisma.TransactionClient, tenantId: string, rows: T[]) {
  const ids = [...new Set(rows.map(row => row.officeId))]
  const labels = ids.length ? await tx.$queryRaw<{ id: string; office: RecordOffice | null }[]>`SELECT x.id,app.booking_office_label(${tenantId},x.id) AS office FROM unnest(${ids}::text[]) x(id)` : []
  const byId = new Map(labels.map(row => [row.id, row.office]))
  return rows.map(row => ({ ...row, office: byId.get(row.officeId) ?? null }))
}

// Keep the long suggestion search outside the write lock, but capture/validate
// its office on a transaction-bound connection, just like the final save.
export function bookingCreationOffice(actor: BusinessActor) {
  return prisma.$transaction(async tx => {
    const current = await authorizeBusinessOperation(tx, actor, "appointments.read", ["appointments"])
    return bookingWriteOffice(tx, current)
  })
}
