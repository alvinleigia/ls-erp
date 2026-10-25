import type { Prisma } from "@prisma/client"
import { databaseOfficeRequest, type OfficeExpectation } from "@/lib/database-office"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export function officeBoundaryError(error: unknown): BusinessError | null {
  const value = error as { message?: string; meta?: { database_error?: string; driverAdapterError?: { cause?: { originalMessage?: string } } } }
  const message = [value?.message, value?.meta?.database_error, value?.meta?.driverAdapterError?.cause?.originalMessage].filter(Boolean).join(" ")
  const messages: readonly [string, number][] = [
    ["Office context changed; reload the creation form", 409],
    ["Select an office and reload the creation form", 403],
    ["Office creation access is not permitted", 403],
    ["Record office access is not permitted", 403],
    ["Leave ownership access is not permitted", 403],
    ["Roster history access is not permitted", 403],
    ["Roster browsing access is not permitted", 403],
    ["Invalid roster selection", 400],
    ["Schedule office access is not permitted", 403],
    ["Flexible plan office access is not permitted", 403],
    ["Daily roster office access is not permitted", 403],
    ["Daily roster template access is not permitted", 403],
    ["Choose staff placed in this office on the selected date", 400],
    ["A daily roster record already exists outside this operation", 409],
    ["Choose staff with workplace coverage for the entire plan", 400],
    ["Resolve overlapping flexible plans before saving", 409],
    ["A flexible plan already exists outside this operation", 409],
    ["Choose staff with workplace coverage for the entire assignment", 400],
    ["Selected staff already have schedules assigned in this range", 409],
    ["Staff workplace access is not permitted", 403],
    ["Staff workplace target not found", 404],
    ["Workplace record changed; refresh before saving", 409],
    ["Choose an active office allowed for this employee", 403],
    ["Resolve active or future work before changing workplace", 409],
    ["Effective date cannot be in the past", 400],
    ["Only a future workplace transfer can be canceled", 400],
    ["Workplace date must follow its current start date", 400],
    ["Workplace already assigned to this office", 409],
    ["Choose an assignee with access to this office", 400],
    ["Linked records must belong to the same office", 400],
    ["A linked source cannot change the record office", 400],
    ["Record office and identity are immutable", 400],
    ["Quotation source and office identity are immutable", 400],
    ["Import provenance is immutable", 400],
  ]
  const found = messages.find(([text]) => message.includes(text))
  return found ? new BusinessError(found[1], found[0] + ".") : null
}

export function officeExpectation(request: Request): OfficeExpectation | null {
  const officeId = request.headers.get("x-office-id"), version = request.headers.get("x-office-version")
  if (officeId === null && version === null) return null
  if (!officeId || !/^[A-Za-z0-9_-]{1,200}$/.test(officeId) || !version || !/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(Number(version))) throw new BusinessError(400, "Invalid office context. Reload the form.")
  return { officeId, version: Number(version) }
}
export async function bindCreationOffice(tx: Prisma.TransactionClient, identity: Pick<BusinessActor, "tenantId" | "userId">) {
  const request = databaseOfficeRequest()
  if (request) {
    const expected = request.expected
    await tx.$executeRaw`SELECT set_config('app.office_id', ${expected?.officeId ?? ""}, true), set_config('app.office_version', ${expected ? String(expected.version) : ""}, true)`
  } else {
    // Trusted service calls capture the persisted choice once, in one round trip.
    // A missing policy still binds an empty context; it never selects a default.
    await tx.$executeRaw`SELECT set_config('app.office_id', COALESCE(p."creationOfficeId", ''), true),
      set_config('app.office_version', CASE WHEN p."creationOfficeId" IS NOT NULL THEN p.version::text ELSE '' END, true)
      FROM (SELECT 1) seed LEFT JOIN "BusinessOfficePolicy" p ON p."tenantId"=${identity.tenantId} AND p."userId"=${identity.userId}`
  }
}
