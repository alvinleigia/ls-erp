import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { permits, satisfies } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { VerificationOwnerReader } from "./cases"
import type { VerificationIdentity } from "./configuration"
import { applicableRequirements, verificationPolicySchema, verificationSubjectSchema, type VerificationSubject } from "./contracts"
import { privateFactsValid, verificationSubmissionSchema, verificationReviewSchema } from "./submission-contracts"
import { disposalAvailableEvidence } from "./disposal-contracts"
import { verificationStatus } from "./submission-status"

export function createVerificationSubmissionService(db: PrismaClient, identity: VerificationIdentity, owner: VerificationOwnerReader) {
  async function run<T>(write: boolean, permission: Requirement, work: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) { await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`; await lockTenantOperations(tx, identity.tenantId) }
      const actor = await authorizeBusinessOperation(tx, identity, ["customerVerification.read", "verificationSubmissions.read", permission], ["customerVerification", "crm"])
      if (actor.collaboratorId) throw new BusinessError(403, "External logins cannot access private verification submissions.")
      return work(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 }).catch(error => {
      if (error?.name?.startsWith("Prisma") || error?.name === "DriverAdapterError") throw new BusinessError(error.code === "P2021" ? 503 : 409, "Verification state or access changed. Refresh and try again.")
      throw error
    })
  }
  async function subjectRow(tx: Prisma.TransactionClient, actor: BusinessActor, subject: VerificationSubject, write = false) {
    const source = await owner(tx, actor, subject)
    if (!source) throw new BusinessError(404, "Customer not found.")
    if (write && source.archived) throw new BusinessError(409, "Choose an active customer.")
    return source
  }
  async function caseRow(tx: Prisma.TransactionClient, actor: BusinessActor, caseId: string, write = false) {
    const row = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, id: caseId } })
    if (!row) throw new BusinessError(404, "Verification case not found.")
    const subject: VerificationSubject = row.contactId ? { kind: "PERSON", id: row.contactId } : { kind: "BUSINESS", id: row.accountId! }
    await subjectRow(tx, actor, subject, write)
    return { row, subject }
  }
  async function policy(tx: Prisma.TransactionClient, actor: BusinessActor, version: number | null = null) {
    const [result] = await tx.$queryRaw<{ policy: { version: number; definition: unknown } | null }[]>`SELECT app.verification_submission_policy(${actor.tenantId},${version}::integer) AS policy`
    if (!result?.policy) throw new BusinessError(409, "Publish verification requirements before submission.")
    return { version: result.policy.version, definition: verificationPolicySchema.parse(result.policy.definition) }
  }
  const latest = (tx: Prisma.TransactionClient, actor: BusinessActor, caseId: string) => tx.verificationSubmission.findFirst({ where: { tenantId: actor.tenantId, caseId }, orderBy: { number: "desc" } })
  const audit = (tx: Prisma.TransactionClient, actor: BusinessActor, event: string, id: string, after: Prisma.InputJsonValue) => recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: `customerVerification.${event}`, entityType: "VerificationSubmission", entityId: id, after })
  return {
    view(input: unknown) {
      const subject = verificationSubjectSchema.parse(input)
      return run(false, "verificationSubmissions.read", async (tx, actor) => {
        const source = await subjectRow(tx, actor, subject), current = await policy(tx, actor)
        const row = await tx.customerVerificationCase.findFirst({ where: { tenantId: actor.tenantId, ...(subject.kind === "PERSON" ? { contactId: subject.id } : { accountId: subject.id }) }, select: { id: true } })
        const submission = row ? await latest(tx, actor, row.id) : null
        const history = row ? await tx.verificationSubmission.findMany({ where: { tenantId: actor.tenantId, caseId: row.id }, orderBy: { number: "desc" }, take: 10, select: { id: true, number: true, policyVersion: true, role: true, submittedAt: true, reason: true, reviews: { orderBy: { number: "desc" }, take: 2, select: { id: true, number: true, decision: true, reason: true, reviewedAt: true, validUntil: true } } } }) : []
        const selected = submission ? await tx.verificationSubmissionEvidence.findMany({ where: { tenantId: actor.tenantId, submissionId: submission.id }, select: { evidenceId: true } }) : []
        const canReadEvidence = permits(actor, "verificationEvidence.read")
        const evidence = row ? await tx.verificationEvidence.findMany({ where: { tenantId: actor.tenantId, caseId: row.id, state: "READY", ...disposalAvailableEvidence, ...(!canReadEvidence ? { uploadedByUserId: actor.userId } : {}) }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, documentCode: true, filename: true, bytes: true, uploadedByUserId: true, finalizedByUserId: true } }) : []
        const revisionPolicy = submission ? await policy(tx, actor, submission.policyVersion) : current
        const selfReview = !!submission && (submission.submittedByUserId === actor.userId || evidence.some(e => selected.some(l => l.evidenceId === e.id) && [e.uploadedByUserId, e.finalizedByUserId].includes(actor.userId)))
        return { case: row, ...await verificationStatus(tx, actor, row?.id), policy: current, revisionPolicy,
          submission: submission ? { id: submission.id, number: submission.number, policyVersion: submission.policyVersion, role: submission.role, facts: submission.facts, reason: submission.reason, submittedAt: submission.submittedAt, evidenceIds: selected.map(l => l.evidenceId) } : null,
          history, evidence: evidence.map(e => ({ id: e.id, documentCode: e.documentCode, filename: e.filename, bytes: e.bytes })),
          canSubmit: !source.archived && permits(actor, "verificationSubmissions.create"), canReview: !source.archived && canReadEvidence && satisfies(actor, ["verificationReviews.read", "verificationReviews.approve"]), canRevoke: canReadEvidence && satisfies(actor, ["verificationReviews.read", "verificationReviews.cancel"]), canReadEvidence, selfReview }
      })
    },
    async submit(input: unknown) {
      const data = verificationSubmissionSchema.parse(input)
      return run(true, "verificationSubmissions.create", async (tx, actor) => {
        const { subject } = await caseRow(tx, actor, data.caseId, true), previous = await latest(tx, actor, data.caseId), current = await policy(tx, actor)
        if ((previous?.number ?? 0) !== data.version || current.version !== data.policyVersion) throw new BusinessError(409, "The submission or policy changed. Refresh before submitting.")
        if (!privateFactsValid(current.definition, subject.kind, data.role, data.facts)) throw new BusinessError(400, "Complete all required facts using their configured formats.")
        const requirements = applicableRequirements(current.definition, subject.kind, data.role)
        const evidence = await tx.verificationEvidence.findMany({ where: { tenantId: actor.tenantId, caseId: data.caseId, id: { in: data.evidenceIds }, state: "READY", ...disposalAvailableEvidence } })
        if (evidence.length !== data.evidenceIds.length || evidence.some(e => e.uploadedByUserId !== actor.userId && !permits(actor, "verificationEvidence.read"))) throw new BusinessError(403, "Select your accepted uploads or evidence you are authorised to read.")
        if (requirements.documents.some(d => !evidence.some(e => e.documentCode === d.code)) || evidence.some(e => !requirements.documents.some(d => d.code === e.documentCode))) throw new BusinessError(400, "Select accepted evidence for every required document type.")
        const row = await tx.verificationSubmission.create({ data: { tenantId: actor.tenantId, caseId: data.caseId, number: data.version + 1, policyVersion: current.version, role: data.role, facts: data.facts, reason: data.reason, submittedByUserId: actor.userId } })
        if (evidence.length) await tx.verificationSubmissionEvidence.createMany({ data: evidence.map(e => ({ tenantId: actor.tenantId, caseId: data.caseId, submissionId: row.id, evidenceId: e.id })) })
        await audit(tx, actor, "submitted", row.id, { caseId: data.caseId, number: row.number, policyVersion: row.policyVersion, factCount: data.facts.length, evidenceCount: evidence.length })
        return { id: row.id, number: row.number, status: "UNDER_REVIEW" }
      })
    },
    async review(input: unknown) {
      const data = verificationReviewSchema.parse(input)
      return run(true, ["verificationReviews.read", data.decision === "REVOKED" ? "verificationReviews.cancel" : "verificationReviews.approve", "verificationEvidence.read"], async (tx, actor) => {
        const submission = await tx.verificationSubmission.findFirst({ where: { tenantId: actor.tenantId, id: data.submissionId } })
        if (!submission) throw new BusinessError(404, "Submission not found.")
        await caseRow(tx, actor, submission.caseId, data.decision !== "REVOKED")
        const current = await latest(tx, actor, submission.caseId), prior = await tx.verificationReview.findFirst({ where: { tenantId: actor.tenantId, submissionId: submission.id }, orderBy: { number: "desc" } })
        const latestRole = await tx.verificationSubmission.findFirst({ where: { tenantId: actor.tenantId, caseId: submission.caseId, role: submission.role }, orderBy: { number: "desc" }, select: { id: true } })
        if (current?.number !== data.version || (prior?.number ?? 0) !== data.reviewVersion || (data.decision !== "REVOKED" && latestRole?.id !== submission.id)) throw new BusinessError(409, "This revision changed. Refresh before reviewing.")
        if (data.decision === "REVOKED" ? prior?.decision !== "APPROVED" : !!prior) throw new BusinessError(409, "A decision is already recorded. Submit corrections as a new revision.")
        if (data.decision === "APPROVED") {
          const selected = await tx.verificationSubmissionEvidence.findMany({ where: { tenantId: actor.tenantId, submissionId: submission.id }, include: { evidence: true } })
          if (submission.submittedByUserId === actor.userId || selected.some(l => [l.evidence.uploadedByUserId, l.evidence.finalizedByUserId].includes(actor.userId))) throw new BusinessError(403, "A different reviewer must approve this submission and evidence.")
          if ((await policy(tx, actor)).version !== submission.policyVersion) throw new BusinessError(409, "Submit the current policy requirements before approval.")
        }
        const row = await tx.verificationReview.create({ data: { tenantId: actor.tenantId, submissionId: submission.id, number: data.reviewVersion + 1, decision: data.decision, reason: data.reason, reviewedByUserId: actor.userId } })
        await audit(tx, actor, "reviewed", submission.id, { caseId: submission.caseId, number: submission.number, reviewNumber: row.number, decision: row.decision, policyVersion: submission.policyVersion })
        return { id: row.id, decision: row.decision, validUntil: row.validUntil }
      })
    },
  }
}
