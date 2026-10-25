import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { officeAllowed } from "@/platform/companies/office-access"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { WorkforceOffice } from "@/types/shifts"

export async function dailyWriteOffice(tx: Prisma.TransactionClient, actor: BusinessActor, existing?: string) {
  const officeId = existing ?? (await tx.$queryRaw<{ id: string }[]>`SELECT app.daily_creation_office(${actor.tenantId}) AS id`)[0]?.id
  if (!officeId || !await officeAllowed(tx, actor, officeId)) throw new BusinessError(403, "Daily roster office access is not permitted.")
  return officeId
}

export async function dailyTarget(tx: Prisma.TransactionClient, tenantId: string, officeId: string, profileId: string, dates: string | string[], family: "SLOT" | "OVERRIDE") {
  const selection = typeof dates === "string" ? [dates] : dates
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT bool_and(app.daily_target_allowed(${tenantId},${officeId},${profileId},x.date,${family})) AS allowed FROM unnest(${selection}::date[]) x(date)`
  if (!row.allowed) throw new BusinessError(400, "Choose staff placed in this office on the selected date.")
}

export async function dailyOfficeLabels<T extends { id: string }>(tx: Prisma.TransactionClient, tenantId: string, family: "SLOT" | "OVERRIDE", rows: T[]) {
  if (!rows.length) return [] as (T & { office: WorkforceOffice | null })[]
  const labels = await tx.$queryRaw<{ id: string; office: WorkforceOffice | null }[]>`SELECT x.id,app.daily_office_label(${tenantId},${family},x.id) AS office FROM unnest(${rows.map(row => row.id)}::text[]) x(id)`
  const offices = new Map(labels.map(row => [row.id, row.office]))
  return rows.map(row => ({ ...row, office: offices.get(row.id) ?? null }))
}

// A date range can include records from several offices. Never put another
// office's rows in a readable audit snapshot, even for a multi-office actor.
export async function auditDaily(tx: Prisma.TransactionClient, actor: BusinessActor, action: "edit" | "archive", profileId: string,
  before: { officeId: string }[], after: { officeId: string }[]) {
  for (const officeId of new Set([...before, ...after].map(row => row.officeId))) {
    await recordDomainAuditEvent(tx, {
      tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
      event: `workforce.shiftRoster.${action}`, entityType: "shiftRoster", entityId: profileId,
      metadata: { officeId, officeFamily: "dailyRoster" },
      before: JSON.parse(JSON.stringify(before.filter(row => row.officeId === officeId))),
      after: JSON.parse(JSON.stringify(after.filter(row => row.officeId === officeId))),
    })
  }
}
