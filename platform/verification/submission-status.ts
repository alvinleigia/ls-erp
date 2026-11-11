import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { permits } from "@/platform/access/policy"

export async function verificationStatus(tx: Prisma.TransactionClient, actor: BusinessActor, caseId: string | undefined) {
  if (!caseId) return { status: "NOT_STARTED", reviewStatusAvailable: false }
  // Ordinary directory/case readers receive no private revision information.
  if (!permits(actor, "verificationSubmissions.read")) return { status: "IN_PROGRESS", reviewStatusAvailable: false }
  const latest = await tx.verificationSubmission.findFirst({ where: { tenantId: actor.tenantId, caseId }, orderBy: { number: "desc" }, select: { id: true, policyVersion: true } })
  if (!latest) return { status: "IN_PROGRESS", reviewStatusAvailable: true }
  const review = await tx.verificationReview.findFirst({ where: { tenantId: actor.tenantId, submissionId: latest.id }, orderBy: { number: "desc" } })
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT statement_timestamp() AS now`
  const [policy] = await tx.$queryRaw<{ version: number }[]>`SELECT app.verification_latest_version(${actor.tenantId}) AS version`
  const status = !review ? "UNDER_REVIEW" : review.decision === "APPROVED" ? (review.validUntil && review.validUntil <= clock.now ? "EXPIRED" : latest.policyVersion !== policy?.version ? "REVIEW_REQUIRED" : "VERIFIED") : review.decision === "REVOKED" ? "REVOKED" : "CHANGES_REQUIRED"
  return { status, reviewStatusAvailable: true }
}
