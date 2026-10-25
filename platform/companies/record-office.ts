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
