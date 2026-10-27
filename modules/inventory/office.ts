import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { officeBoundaryError } from "@/platform/companies/record-office"
import type { BusinessActor } from "@/platform/policy"
import type { RecordOffice } from "@/types/companies"

export function inventoryError(error: unknown): never { throw officeBoundaryError(error) ?? error }
export async function stockOffice(tx: Prisma.TransactionClient, tenantId: string, requested?: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT app.inventory_read_office(${tenantId},${requested ?? null}) id`
  return row.id
}
export async function inventoryOfficeLabel(tx: Prisma.TransactionClient, tenantId: string, officeId: string, resource = "inventoryProducts") {
  const [row] = await tx.$queryRaw<{ office: RecordOffice }[]>`SELECT app.inventory_office_label(${tenantId},${officeId},${resource}) office`
  return row.office
}
export function inventoryRead<T>(actor: BusinessActor, resource: "inventoryProducts" | "inventoryPurchases", read: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`workforce-schedules:${actor.tenantId}`},0))`
    await authorizeBusinessOperation(tx, actor, `${resource}.read`, ["inventory"])
    return read(tx)
  }, { timeout: 30_000 }).catch(inventoryError)
}
