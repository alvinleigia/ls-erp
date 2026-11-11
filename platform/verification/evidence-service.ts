import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import type { Prisma, PrismaClient, VerificationEvidence } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { permits } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { VerificationIdentity } from "./configuration"
import type { VerificationOwnerReader } from "./cases"
import { verificationDocumentSchema, verificationSubjectSchema, type VerificationSubject } from "./contracts"
import { evidenceUploadSchema, EVIDENCE_LIMIT, EVIDENCE_CASE_LIMIT } from "./evidence-contracts"
import { validateEvidenceFile } from "./evidence-files"
import { evidencePath, privateEvidenceStorage, type EvidenceStorage } from "./evidence-storage"
import { disposalAvailableEvidence } from "./disposal-contracts"
import { verificationStatus } from "./submission-status"

const identifier = z.string().min(1).max(100)
const metadata = (r: VerificationEvidence) => ({ id: r.id, documentCode: r.documentCode, filename: r.filename, contentType: r.contentType, bytes: r.bytes, state: r.state, createdAt: r.createdAt, readyAt: r.readyAt, expiresAt: r.expiresAt })
const collectionPolicySchema = z.object({ version: z.number().int().positive(), documents: z.array(verificationDocumentSchema).max(20) })
export function createVerificationEvidenceService(db: PrismaClient, identity: VerificationIdentity, owner: VerificationOwnerReader, storage: EvidenceStorage = privateEvidenceStorage) {
  async function run<T>(write: boolean, requirement: Requirement, work: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) { await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`; await lockTenantOperations(tx, identity.tenantId) }
      const actor = await authorizeBusinessOperation(tx, identity, ["customerVerification.read", requirement], ["customerVerification"])
      if (actor.collaboratorId) throw new BusinessError(403, "External logins cannot access private verification evidence.")
      return work(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 }).catch(error => {
      // Native adapter errors can include the rejected row. Never pass private
      // filenames, object paths or hashes to the general API error logger.
      if (error?.name?.startsWith("Prisma") || error?.name === "DriverAdapterError") throw new BusinessError(error.code === "P2021" ? 503 : 409, "Verification state or access changed. Refresh and try again.")
      throw error
    })
  }
  async function source(tx: Prisma.TransactionClient, actor: BusinessActor, subject: VerificationSubject, write = false) {
    const row = await owner(tx, actor, subject)
    if (!row) throw new BusinessError(404, "Customer not found.")
    if (write && row.archived) throw new BusinessError(409, "Choose an active customer.")
    return row
  }
  async function caseRow(tx: Prisma.TransactionClient, actor: BusinessActor, caseId: string, write = false) {
    const row = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, id: caseId } })
    if (!row) throw new BusinessError(404, "Verification case not found.")
    const subject: VerificationSubject = row.contactId ? { kind: "PERSON", id: row.contactId } : { kind: "BUSINESS", id: row.accountId! }
    await source(tx, actor, subject, write)
    return { row, subject }
  }
  async function policy(tx: Prisma.TransactionClient, actor: BusinessActor, kind: VerificationSubject["kind"]) {
    const [row] = await tx.$queryRaw<{ policy: unknown }[]>`SELECT app.verification_collection_policy(${actor.tenantId},${kind}) AS policy`
    return row?.policy ? collectionPolicySchema.parse(row.policy) : null
  }
  async function upload(tx: Prisma.TransactionClient, actor: BusinessActor, id: string) {
    const row = await tx.verificationEvidence.findFirst({ where: { tenantId: actor.tenantId, id: identifier.parse(id) } })
    if (!row) throw new BusinessError(404, "Upload not found.")
    await caseRow(tx, actor, row.caseId)
    if (row.uploadedByUserId !== actor.userId && actor.role !== "ADMIN") throw new BusinessError(403, "Only the uploader or a tenant administrator can finish or cancel this upload.")
    return row
  }
  const audit = (tx: Prisma.TransactionClient, actor: BusinessActor, event: string, id: string, after: Prisma.InputJsonValue) => recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: `customerVerification.${event}`, entityType: "VerificationEvidence", entityId: id, after })
  async function abandon(id: string, failureCode: "CANCELLED" | "INVALID_FILE", requirement: Requirement = "verificationUploads.cancel") {
    return run(true, requirement, async (tx, actor) => {
      const row = await upload(tx, actor, id)
      if (row.state === "READY") throw new BusinessError(409, "Accepted evidence cannot be cancelled or overwritten.")
      if (row.state !== "ABANDONED") {
        await tx.verificationEvidence.updateMany({ where: { tenantId: actor.tenantId, id, state: "PENDING" }, data: { state: "ABANDONED", failureCode } })
        await audit(tx, actor, "uploadAbandoned", id, { failureCode })
      }
      return { id, state: "ABANDONED" as const }
    })
  }
  return {
    view(input: unknown) {
      const subject = verificationSubjectSchema.parse(input)
      return run(false, "customerVerification.read", async (tx, actor) => {
        const customer = await source(tx, actor, subject)
        const row = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, ...(subject.kind === "PERSON" ? { contactId: subject.id } : { accountId: subject.id }) }, select: { id: true } })
        const requirements = await policy(tx, actor, subject.kind)
        const canReadEvidence = permits(actor, "verificationEvidence.read"), canUpload = !customer.archived && permits(actor, "verificationUploads.create"), canCancel = permits(actor, "verificationUploads.cancel")
        const evidence = row && canReadEvidence ? await tx.verificationEvidence.findMany({ where: { tenantId: actor.tenantId, caseId: row.id, state: "READY", ...disposalAvailableEvidence }, orderBy: { createdAt: "desc" }, take: EVIDENCE_CASE_LIMIT }) : []
        const pending = row && permits(actor, "verificationUploads.read") ? await tx.verificationEvidence.findMany({ where: { tenantId: actor.tenantId, caseId: row.id, uploadedByUserId: actor.userId, state: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: EVIDENCE_CASE_LIMIT }) : []
        return { case: row, subject, ...await verificationStatus(tx, actor, row?.id), policyVersion: requirements?.version ?? 0, documents: requirements?.documents ?? [], canStart: !customer.archived && permits(actor, "customerVerification.create"), canUpload, canCancel, canCleanup: actor.role === "ADMIN" && canCancel, canReadEvidence, canReadHolds: permits(actor, "verificationHolds.read"), canReadSubmissions: permits(actor, "verificationSubmissions.read"), evidence: evidence.map(metadata), pending: pending.map(metadata), fileLimit: EVIDENCE_LIMIT }
      })
    },
    async reserve(input: unknown) {
      const data = evidenceUploadSchema.parse(input)
      const row = await run(true, "verificationUploads.create", async (tx, actor) => {
        const { subject } = await caseRow(tx, actor, data.caseId, true), current = await policy(tx, actor, subject.kind)
        if (!current || !current.documents.some(d => d.code === data.documentCode)) throw new BusinessError(409, "Choose a document type from the current verification requirements.")
        const [capacity] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.verification_evidence_capacity(${actor.tenantId},${data.caseId}) AS allowed`
        if (!capacity?.allowed) throw new BusinessError(409, "The case or business upload limit has been reached. Clean up expired unaccepted uploads before adding more files.")
        const id = randomUUID(), path = evidencePath(actor.tenantId, data.caseId, id, data.contentType)
        const created = await tx.verificationEvidence.create({ data: { ...data, id, tenantId: actor.tenantId, policyVersion: current.version, path, uploadedByUserId: actor.userId, expiresAt: new Date(Date.now() + 3 * 3600_000) } })
        await audit(tx, actor, "uploadReserved", id, { caseId: data.caseId, policyVersion: current.version })
        return created
      })
      try {
        const uploadUrl = await storage.signUpload(row.path)
        await run(false, "verificationUploads.create", async (tx, actor) => { const current = await upload(tx, actor, row.id); if (current.state !== "PENDING") throw new BusinessError(409, "This upload is no longer pending.") })
        return { id: row.id, uploadUrl, expiresAt: row.expiresAt }
      } catch (error) {
        // No storage call is hidden inside a retried business transaction.
        // Keep the reservation for expiry cleanup if fresh authority was revoked.
        await abandon(row.id, "CANCELLED", "verificationUploads.create").catch(() => undefined)
        throw error
      }
    },
    async finalize(id: string) {
      const initial = await run(false, "verificationUploads.create", async (tx, actor) => upload(tx, actor, id))
      if (initial.state === "READY") return metadata(initial)
      if (initial.state !== "PENDING" || initial.expiresAt <= new Date()) throw new BusinessError(409, "This upload expired or was cancelled. Select the file again.")
      let sha256: string
      try { sha256 = (await validateEvidenceFile(await storage.read(initial.path), initial)).sha256 }
      catch (error) {
        if (error instanceof BusinessError && [400, 413].includes(error.status)) await abandon(id, "INVALID_FILE", "verificationUploads.create").catch(() => undefined)
        throw error
      }
      return run(true, "verificationUploads.create", async (tx, actor) => {
        const row = await upload(tx, actor, id)
        if (row.state === "READY") return metadata(row)
        const { subject } = await caseRow(tx, actor, row.caseId, true), current = await policy(tx, actor, subject.kind)
        if (row.state !== "PENDING" || row.expiresAt <= new Date() || current?.version !== row.policyVersion || !current.documents.some(d => d.code === row.documentCode)) throw new BusinessError(409, "The upload or its requirements changed. Cancel it and select the file again.")
        await tx.verificationEvidence.updateMany({ where: { tenantId: actor.tenantId, id, state: "PENDING" }, data: { state: "READY", sha256, readyAt: new Date(), finalizedByUserId: actor.userId } })
        await audit(tx, actor, "evidenceAccepted", id, { caseId: row.caseId, policyVersion: row.policyVersion })
        return metadata({ ...row, state: "READY", readyAt: new Date() })
      })
    },
    cancel: (id: string) => abandon(id, "CANCELLED"),
    async download(id: string) {
      const row = await run(false, "verificationEvidence.read", async (tx, actor) => {
        const row = await tx.verificationEvidence.findFirst({ where: { tenantId: actor.tenantId, id: identifier.parse(id), state: "READY", ...disposalAvailableEvidence } })
        if (!row) throw new BusinessError(404, "Evidence not found.")
        await caseRow(tx, actor, row.caseId)
        return row
      })
      const bytes = await storage.read(row.path)
      if (bytes.length !== row.bytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new BusinessError(409, "This file failed its integrity check. Contact your administrator.")
      // Recheck authority after network I/O, immediately before returning a
      // 60-second bearer download link. Already issued links expire naturally.
      const url = await storage.download(row.path, row.filename)
      await run(false, "verificationEvidence.read", async (tx, actor) => { if (!await tx.verificationEvidence.findFirst({ where: { tenantId: actor.tenantId, id: row.id, state: "READY", ...disposalAvailableEvidence }, select: { id: true } })) throw new BusinessError(409, "This original is quarantined or disposed."); await caseRow(tx, actor, row.caseId); await audit(tx, actor, "evidenceDownloaded", row.id, { caseId: row.caseId }) })
      return { url }
    },
    async cleanup() {
      const candidates = await run(false, "verificationUploads.cancel", async (tx, actor) => {
        if (actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must clean up expired uploads.")
        return tx.verificationEvidence.findMany({ where: { tenantId: actor.tenantId, state: { in: ["PENDING", "ABANDONED"] }, cleanedAt: null, expiresAt: { lte: new Date() } }, orderBy: { expiresAt: "asc" }, take: 20 })
      })
      let cleaned = 0
      for (const row of candidates) {
        const eligible = await run(true, "verificationUploads.cancel", async (tx, actor) => {
          if (actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must clean up expired uploads.")
          const [expired] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "VerificationEvidence" WHERE "tenantId"=${actor.tenantId} AND id=${row.id} AND state IN ('PENDING','ABANDONED') AND "cleanedAt" IS NULL AND "expiresAt"<=CURRENT_TIMESTAMP`
          if (!expired) return false
          const changed = await tx.verificationEvidence.updateMany({ where: { tenantId: actor.tenantId, id: row.id, state: { in: ["PENDING", "ABANDONED"] }, OR: [{ failureCode: null }, { failureCode: { not: "EXPIRED" } }] }, data: { state: "ABANDONED", failureCode: "EXPIRED" } })
          if (changed.count) await audit(tx, actor, "uploadExpired", row.id, { expired: true })
          return true
        })
        if (!eligible) continue
        await storage.remove(row.path)
        await run(true, "verificationUploads.cancel", async (tx, actor) => {
          if (actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must clean up expired uploads.")
          const result = await tx.verificationEvidence.updateMany({ where: { tenantId: actor.tenantId, id: row.id, state: { in: ["PENDING", "ABANDONED"] }, cleanedAt: null, expiresAt: { lte: new Date() } }, data: { state: "ABANDONED", cleanedAt: new Date(), failureCode: "EXPIRED" } })
          if (result.count) { cleaned++; await audit(tx, actor, "uploadCleaned", row.id, { expired: true }) }
        })
      }
      return { cleaned }
    },
  }
}
