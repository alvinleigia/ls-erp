import type { Prisma } from "@prisma/client"
import type { RecordOffice } from "@/types/companies"

// Call only after the owning module has authorized the source record. Office
// eligibility is an additional boundary, never a replacement for record scope.
export async function recordOfficeLabel(tx: Prisma.TransactionClient, tenantId: string, officeId: string) {
  const [row] = await tx.$queryRaw<{ office: RecordOffice | null }[]>`SELECT app.record_office_label(${tenantId},${officeId}) AS office`
  return row?.office ?? null
}
