import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { verificationSubjectSchema, type VerificationSubject } from "./contracts"
import type { VerificationIdentity } from "./configuration"
import { verificationStatus } from "./submission-status"

export type VerificationOwnerReader = (tx: Prisma.TransactionClient, actor: BusinessActor, subject: VerificationSubject) => Promise<{ id: string; archived: boolean } | null>
// Source adapters retain the canonical directory's office/sharing/record scope.
// A case is not an approval; submissions, uploads and review are separate steps.
export function createVerificationCaseService(db: PrismaClient, identity: VerificationIdentity, owner: VerificationOwnerReader) {
  async function run(input: unknown, write: boolean) {
    const subject = verificationSubjectSchema.parse(input)
    return db.$transaction(async tx => {
      if (write) {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
        await lockTenantOperations(tx, identity.tenantId)
      }
      const actor = await authorizeBusinessOperation(tx, identity, write ? ["customerVerification.read", "customerVerification.create"] : "customerVerification.read", ["customerVerification", "crm"])
      if (actor.collaboratorId) throw new BusinessError(403, "External logins cannot collect customer verification.")
      const source = await owner(tx, actor, subject)
      if (!source) throw new BusinessError(404, "Customer not found.")
      if (write && source.archived) throw new BusinessError(409, "Choose an active customer.")
      const where = { tenantId: actor.tenantId, ...(subject.kind === "PERSON" ? { contactId: subject.id } : { accountId: subject.id }) }
      const existing = await tx.customerVerificationCase.findFirst({ where, select: { id: true, policyVersion: true, createdAt: true } })
      const [policy] = await tx.$queryRaw<{ version: number | null }[]>`SELECT app.verification_latest_version(${actor.tenantId}) AS version`
      const policyVersion = policy?.version ?? 0
      if (existing || !write) return { subject, case: existing, ...await verificationStatus(tx, actor, existing?.id), policyVersion }
      if (!policyVersion) throw new BusinessError(409, "Publish verification requirements before starting collection.")
      const row = await tx.customerVerificationCase.create({ data: { ...where, policyVersion, createdByUserId: actor.userId }, select: { id: true, policyVersion: true, createdAt: true } })
      await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "customerVerification.started", entityType: "CustomerVerificationCase", entityId: row.id, after: { policyVersion: row.policyVersion } })
      return { subject, case: row, status: "IN_PROGRESS" as const, policyVersion }
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
  }
  return { get: (input: unknown) => run(input, false), start: (input: unknown) => run(input, true) }
}
