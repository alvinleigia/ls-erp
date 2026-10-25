import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { officeAllowed } from "@/platform/companies/office-access"
import type { WorkforceOffice } from "@/types/shifts"

export async function flexibleWriteOffice(tx: Prisma.TransactionClient, actor: BusinessActor, existing?: string) {
  const officeId = existing ?? (await tx.$queryRaw<{ id: string }[]>`SELECT app.flexible_creation_office(${actor.tenantId}) AS id`)[0]?.id
  if (!officeId || !await officeAllowed(tx, actor, officeId)) throw new BusinessError(403, "Flexible plan office access is not permitted.")
  return officeId
}

export async function flexibleTarget(tx: Prisma.TransactionClient, tenantId: string, officeId: string, profileId: string, first: string, last?: string | null) {
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.flexible_target_allowed(${tenantId},${officeId},${profileId},${first}::date,${last || null}::date) AS allowed`
  if (!row.allowed) throw new BusinessError(400, "Choose staff with workplace coverage for the entire plan.")
}

export async function flexibleOfficeLabels<T extends { id: string }>(tx: Prisma.TransactionClient, tenantId: string, family: "WEEK" | "PATTERN", rows: T[]) {
  if (!rows.length) return [] as (T & { office: WorkforceOffice | null })[]
  const labels = await tx.$queryRaw<{ id: string; office: WorkforceOffice | null }[]>`SELECT x.id,app.flexible_office_label(${tenantId},${family},x.id) AS office FROM unnest(${rows.map(row => row.id)}::text[]) x(id)`
  const offices = new Map(labels.map(row => [row.id, row.office]))
  return rows.map(row => ({ ...row, office: offices.get(row.id) ?? null }))
}
