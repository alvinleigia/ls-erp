import { createHash } from "node:crypto"
import type { Prisma, PrismaClient, VerificationDisposal, VerificationEvidence } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { VerificationIdentity } from "./configuration"
import type { VerificationOwnerReader } from "./cases"
import { disposalActionSchema, disposalPreviewSchema, disposalRequestSchema } from "./disposal-contracts"
import { privateDisposalStorage, type DisposalStorage } from "./disposal-storage"
const publicRow = (r: VerificationDisposal) => ({ id: r.id, evidenceId: r.evidenceId, version: r.version, state: r.state, retryAfter: r.retryAfter, completedAt: r.completedAt })
export function createVerificationDisposalService(db: PrismaClient, identity: VerificationIdentity, owner: VerificationOwnerReader, storage: DisposalStorage = privateDisposalStorage) {
  async function run<T>(write: boolean, action: "read" | "create" | "approve" | "cancel", fn: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) { await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`; await lockTenantOperations(tx, identity.tenantId) }
      const actor = await authorizeBusinessOperation(tx, identity, ["customerVerification.read", "verificationEvidence.read", "verificationRetention.read", "verificationDisposals.read", `verificationDisposals.${action}`], ["customerVerification", "crm"])
      if (actor.role !== "ADMIN" || actor.collaboratorId) throw new BusinessError(403, "A tenant administrator must manage evidence disposal.")
      return fn(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 }).catch(error => {
      if (error?.name?.startsWith("Prisma") || error?.name === "DriverAdapterError") throw new BusinessError(409, "The disposal or its protections changed. Refresh before continuing.")
      throw error
    })
  }
  async function evidence(tx: Prisma.TransactionClient, actor: BusinessActor, id: string) {
    const e = await tx.verificationEvidence.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!e) throw new BusinessError(404, "Evidence not found.")
    const c = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, id: e.caseId } })
    if (!c || !await owner(tx, actor, c.contactId ? { kind: "PERSON", id: c.contactId } : { kind: "BUSINESS", id: c.accountId! })) throw new BusinessError(404, "Verification case not found.")
    return e
  }
  async function prepare(tx: Prisma.TransactionClient, actor: BusinessActor, evidenceId: string) {
    const e = await evidence(tx, actor, evidenceId), [decision] = await tx.$queryRaw<{ d: { decision: string; policyVersion: number } | null }[]>`SELECT app.verification_retention_decision(${actor.tenantId},${e.id}) AS d`
    if (e.state !== "READY" || decision?.d?.decision !== "REVIEW" || await tx.verificationDisposal.findFirst({ where: { tenantId: actor.tenantId, evidenceId, state: { not: "CANCELLED" } } })) throw new BusinessError(409, "Only eligible, unreferenced evidence without a hold or active disposal can be removed.")
    const policyVersion = decision.d.policyVersion, previewHash = createHash("sha256").update(JSON.stringify({ tenantId: actor.tenantId, evidenceId, caseId: e.caseId, policyVersion, sha256: e.sha256, bytes: e.bytes, readyAt: e.readyAt })).digest("hex")
    return { e, policyVersion, previewHash }
  }
  async function requestRow(tx: Prisma.TransactionClient, actor: BusinessActor, id: string) {
    const r = await tx.verificationDisposal.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!r) throw new BusinessError(404, "Disposal request not found.")
    return { r, e: await evidence(tx, actor, r.evidenceId) }
  }
  const audit = (tx: Prisma.TransactionClient, actor: BusinessActor, r: VerificationDisposal) => recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, event: "customerVerification.disposalChanged", entityType: "VerificationDisposal", entityId: r.id, requestId: actor.requestId, after: { evidenceId: r.evidenceId, version: r.version, state: r.state } })
  function verifyObject(e: VerificationEvidence, object: Awaited<ReturnType<DisposalStorage["inspect"]>>) {
    if (object.exists && (object.bytes !== e.bytes || object.sha256 !== e.sha256)) throw new BusinessError(409, "The stored original failed its integrity check. Disposal was stopped.")
  }
  return {
    preview: (input: unknown) => {
      const { evidenceId } = disposalPreviewSchema.parse(input)
      return run(false, "create", async (tx, actor) => { const p = await prepare(tx, actor, evidenceId); return { evidenceId, filename: p.e.filename, policyVersion: p.policyVersion, previewHash: p.previewHash } })
    },
    request: (input: unknown) => {
      const data = disposalRequestSchema.parse(input)
      return run(true, "create", async (tx, actor) => {
        const existing = await tx.verificationDisposal.findFirst({ where: { tenantId: actor.tenantId, id: data.requestKey } })
        if (existing) {
          await evidence(tx, actor, existing.evidenceId)
          if (existing.evidenceId !== data.evidenceId || existing.previewHash !== data.previewHash || existing.reason !== data.reason || existing.createdByUserId !== actor.userId) throw new BusinessError(409, "This disposal request key has already been used.")
          return publicRow(existing)
        }
        const p = await prepare(tx, actor, data.evidenceId)
        if (p.previewHash !== data.previewHash) throw new BusinessError(409, "The evidence or retention policy changed. Preview disposal again.")
        const r = await tx.verificationDisposal.create({ data: { id: data.requestKey, tenantId: actor.tenantId, caseId: p.e.caseId, evidenceId: p.e.id, policyVersion: p.policyVersion, previewHash: data.previewHash, reason: data.reason, createdByUserId: actor.userId, actorUserId: actor.userId } })
        await audit(tx, actor, r); return publicRow(r)
      })
    },
    async act(input: unknown) {
      const data = disposalActionSchema.parse(input)
      if (data.action === "cancel") return run(true, "cancel", async (tx, actor) => {
        const { r } = await requestRow(tx, actor, data.id)
        if (r.state === "CANCELLED") return publicRow(r)
        if (r.version !== data.version || r.state !== "PENDING") throw new BusinessError(409, "Removal has started or the request changed. It cannot be cancelled.")
        const next = await tx.verificationDisposal.update({ where: { id: r.id }, data: { state: "CANCELLED", version: { increment: 1 }, actorUserId: actor.userId } }); await audit(tx, actor, next); return publicRow(next)
      })
      const initial = await run(false, "approve", (tx, actor) => requestRow(tx, actor, data.id))
      if (initial.r.state === "COMPLETED") return publicRow(initial.r)
      if (initial.r.version !== data.version || initial.r.state !== (data.action === "execute" ? "PENDING" : "DELETING")) throw new BusinessError(409, "The disposal request changed. Refresh before continuing.")
      // Inspect before starting an irreversible removal. Missing means only an
      // authoritative object-not-found result, never a timeout or denied request.
      let object: Awaited<ReturnType<DisposalStorage["inspect"]>>
      try { object = await storage.inspect(initial.e.path) } catch { throw new BusinessError(503, "Unable to confirm the original's storage state. No removal was started.") }
      verifyObject(initial.e, object)
      const started = await run(true, "approve", async (tx, actor) => {
        const { r, e } = await requestRow(tx, actor, data.id)
        if (r.version !== data.version || r.state !== initial.r.state) throw new BusinessError(409, "Another disposal action won. Refresh before continuing.")
        const next = await tx.verificationDisposal.update({ where: { id: r.id }, data: { state: "DELETING", version: { increment: 1 }, actorUserId: actor.userId } }); await audit(tx, actor, next); return { r: next, e }
      })
      try {
        // Authority may have changed during the first storage read. Starting is
        // durable; an uncertain result remains quarantined for reconciliation.
        await run(false, "approve", async (tx, actor) => { const { r } = await requestRow(tx, actor, data.id); if (r.state !== "DELETING" || r.version !== started.r.version) throw new BusinessError(409, "The removal attempt changed.") })
        if (object.exists) await storage.remove(started.e.path)
        if ((await storage.inspect(started.e.path)).exists) throw new BusinessError(503, "Storage has not confirmed removal.")
        return await run(true, "approve", async (tx, actor) => {
          const { r } = await requestRow(tx, actor, data.id)
          if (r.state === "COMPLETED") return publicRow(r)
          if (r.state !== "DELETING" || r.version !== started.r.version) throw new BusinessError(409, "The removal attempt changed. Reconcile its outcome.")
          const next = await tx.verificationDisposal.update({ where: { id: r.id }, data: { state: "COMPLETED", version: { increment: 1 }, actorUserId: actor.userId } }); await audit(tx, actor, next); return publicRow(next)
        })
      } catch {
        throw new BusinessError(503, "Removal outcome needs reconciliation. The original remains quarantined. Refresh and retry reconciliation after the displayed time; do not restore or reuse this file.")
      }
    },
  }
}
