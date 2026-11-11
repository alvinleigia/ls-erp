import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { permits } from "@/platform/access/policy"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { Requirement } from "@/platform/access/catalog"
import type { VerificationIdentity } from "./configuration"
import type { VerificationOwnerReader } from "./cases"
import { verificationSubjectSchema, type VerificationSubject } from "./contracts"
import { retentionInputSchema, retentionPublishSchema, verificationHoldSchema, type RetentionDecision } from "./retention-contracts"

export function createVerificationRetentionService(db: PrismaClient, identity: VerificationIdentity, owner: VerificationOwnerReader) {
  async function run<T>(write: boolean, requirement: Requirement, fn: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) { await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`; await lockTenantOperations(tx, identity.tenantId) }
      const actor = await authorizeBusinessOperation(tx, identity, requirement, ["customerVerification", "crm"])
      if (actor.collaboratorId) throw new BusinessError(403, "External logins cannot manage verification retention.")
      return fn(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 }).catch(error => {
      if (error?.name?.startsWith("Prisma") || error?.name === "DriverAdapterError") throw new BusinessError(409, "Verification retention or access changed. Refresh and try again.")
      throw error
    })
  }
  async function current(tx: Prisma.TransactionClient, actor: BusinessActor) {
    const r = await tx.verificationRetentionVersion.findFirst({ where: { tenantId: actor.tenantId }, orderBy: { version: "desc" } })
    return { version: r?.version ?? 0, retainDays: r?.retainDays ?? null, canPublish: actor.role === "ADMIN" && permits(actor, "verificationRetention.edit") }
  }
  async function prepare(tx: Prisma.TransactionClient, actor: BusinessActor, input: unknown) {
    if (actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must publish retention settings.")
    const data = retentionInputSchema.parse(input), saved = await current(tx, actor)
    if (data.version !== saved.version) throw new BusinessError(409, "Retention settings changed. Reload before publishing.")
    return { data, previewHash: createHash("sha256").update(JSON.stringify({ tenantId: actor.tenantId, ...data })).digest("hex") }
  }
  const caseSubject = (r: { contactId: string | null; accountId: string | null }): VerificationSubject => r.contactId ? { kind: "PERSON", id: r.contactId } : { kind: "BUSINESS", id: r.accountId! }
  return {
    settings: () => run(false, "verificationRetention.read", current),
    preview: (input: unknown) => run(true, ["verificationRetention.read", "verificationRetention.edit"], (tx, actor) => prepare(tx, actor, input)),
    publish: (input: unknown) => run(true, ["verificationRetention.read", "verificationRetention.edit"], async (tx, actor) => {
      const { previewHash, ...inputData } = retentionPublishSchema.parse(input), checked = await prepare(tx, actor, inputData)
      if (previewHash !== checked.previewHash) throw new BusinessError(409, "Retention draft changed. Preview again before publishing.")
      const version = checked.data.version + 1
      await tx.verificationRetentionVersion.create({ data: { tenantId: actor.tenantId, version, retainDays: checked.data.retainDays, publishedByUserId: actor.userId } })
      await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, event: "customerVerification.retentionPublished", entityType: "VerificationRetentionVersion", entityId: actor.tenantId, requestId: actor.requestId, after: { version, retainDays: checked.data.retainDays } })
      return { version, retainDays: checked.data.retainDays, canPublish: true }
    }),
    view: (input: unknown) => run(false, ["customerVerification.read", "verificationHolds.read"], async (tx, actor) => {
      const subject = verificationSubjectSchema.parse(input)
      if (!await owner(tx, actor, subject)) throw new BusinessError(404, "Customer not found.")
      const row = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, ...(subject.kind === "PERSON" ? { contactId: subject.id } : { accountId: subject.id }) } })
      const history = row ? await tx.verificationHoldEvent.findMany({ where: { tenantId: actor.tenantId, caseId: row.id }, orderBy: { number: "desc" }, take: 10 }) : []
      const canReview = actor.role === "ADMIN" && permits(actor, "verificationRetention.read") && permits(actor, "verificationEvidence.read")
      const evidence = row && canReview ? await tx.verificationEvidence.findMany({ where: { tenantId: actor.tenantId, caseId: row.id, state: "READY" }, select: { id: true, filename: true }, orderBy: { readyAt: "desc" }, take: 20 }) : []
      const results = evidence.length ? await tx.$queryRaw<{ id: string; decision: RetentionDecision | null }[]>`SELECT id, app.verification_retention_decision(${actor.tenantId},id) AS decision FROM "VerificationEvidence" WHERE "tenantId"=${actor.tenantId} AND id=ANY(${evidence.map(e => e.id)}::text[])` : []
      const decisions = evidence.map(e => {
        const decision = results.find(r => r.id === e.id)?.decision
        if (!decision) throw new BusinessError(404, "Retention review unavailable.")
        return { ...e, ...decision }
      })
      const canDispose = actor.role === "ADMIN" && permits(actor, "verificationDisposals.read")
      const select = { id: true, evidenceId: true, version: true, state: true, reason: true, createdAt: true, startedAt: true, retryAfter: true, completedAt: true } as const
      const [recent, activeRequests] = row && canDispose ? await Promise.all([
        tx.verificationDisposal.findMany({ where: { tenantId: actor.tenantId, caseId: row.id }, select, orderBy: { createdAt: "desc" }, take: 10 }),
        tx.verificationDisposal.findMany({ where: { tenantId: actor.tenantId, caseId: row.id, state: { in: ["PENDING", "DELETING"] } }, select, orderBy: { createdAt: "desc" } }),
      ]) : [[], []]
      const recentDisposals = [...new Map([...activeRequests, ...recent].map(r => [r.id, r])).values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return { canDispose, disposals: recentDisposals, case: row ? { id: row.id } : null, version: history[0]?.number ?? 0, active: history[0]?.action === "PLACE", history, canPlace: permits(actor, "verificationHolds.create"), canRelease: permits(actor, "verificationHolds.cancel"), canReview, decisions }
    }),
    hold: (input: unknown) => {
      const data = verificationHoldSchema.parse(input)
      return run(true, ["customerVerification.read", "verificationHolds.read", data.action === "PLACE" ? "verificationHolds.create" : "verificationHolds.cancel"], async (tx, actor) => {
        const row = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, id: data.caseId } })
        if (!row || !await owner(tx, actor, caseSubject(row))) throw new BusinessError(404, "Verification case not found.")
        if (data.action === "PLACE" && await tx.verificationDisposal.findFirst({ where: { tenantId: actor.tenantId, caseId: row.id, state: "DELETING" }, select: { id: true } })) throw new BusinessError(409, "An irreversible file disposal is in progress. Reconcile its outcome before placing a preservation hold.")
        const last = await tx.verificationHoldEvent.findFirst({ where: { tenantId: actor.tenantId, caseId: row.id }, orderBy: { number: "desc" } })
        if ((last?.number ?? 0) !== data.version || (data.action === "PLACE") === (last?.action === "PLACE")) throw new BusinessError(409, "The preservation hold changed. Refresh before continuing.")
        const event = await tx.verificationHoldEvent.create({ data: { tenantId: actor.tenantId, caseId: row.id, number: data.version + 1, action: data.action, reason: data.reason, actorUserId: actor.userId } })
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, event: "customerVerification.holdChanged", entityType: "CustomerVerificationCase", entityId: row.id, requestId: actor.requestId, after: { version: event.number, action: data.action } })
        return { version: event.number, active: event.action === "PLACE" }
      })
    },
  }
}
