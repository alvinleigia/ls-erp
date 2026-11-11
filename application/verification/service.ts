import type { PrismaClient } from "@prisma/client"
import { createVerificationCaseService } from "@/platform/verification/cases"
import type { VerificationIdentity } from "@/platform/verification/configuration"
import { accountScope, contactScope } from "@/modules/crm/policy"
import { requirePermission } from "@/platform/access/policy"
import type { VerificationOwnerReader } from "@/platform/verification/cases"
import { createVerificationEvidenceService } from "@/platform/verification/evidence-service"
import type { EvidenceStorage } from "@/platform/verification/evidence-storage"
import { createVerificationSubmissionService } from "@/platform/verification/submission-service"
import { createVerificationSourceService } from "@/platform/verification/source-service"
import { opportunityScope } from "@/modules/crm/policy"
import { salesOrderRecordScope } from "@/platform/access/record-scope"

import { createVerificationRetentionService } from "@/platform/verification/retention-service"
import { createVerificationDisposalService } from "@/platform/verification/disposal-service"
import type { DisposalStorage } from "@/platform/verification/disposal-storage"
export function applicationVerificationDisposal(db: PrismaClient, identity: VerificationIdentity, storage?: DisposalStorage) { return createVerificationDisposalService(db, identity, verificationOwner, storage) }
export function applicationVerificationRetention(db: PrismaClient, identity: VerificationIdentity) { return createVerificationRetentionService(db, identity, verificationOwner) }

export function applicationVerificationCases(db: PrismaClient, identity: VerificationIdentity) {
  return createVerificationCaseService(db, identity, verificationOwner)
}
const verificationOwner: VerificationOwnerReader = (tx, actor, subject) => {
    requirePermission(actor, subject.kind === "PERSON" ? "contacts.read" : "accounts.read")
    return subject.kind === "PERSON"
      ? tx.crmContact.findFirst({ where: { ...contactScope(actor, "read"), id: subject.id }, select: { id: true, archived: true } })
      : tx.crmAccount.findFirst({ where: { ...accountScope(actor, "read"), id: subject.id }, select: { id: true, archived: true } })
}
export function applicationVerificationEvidence(db: PrismaClient, identity: VerificationIdentity, storage?: EvidenceStorage) {
  return createVerificationEvidenceService(db, identity, verificationOwner, storage)
}
export function applicationVerificationSubmissions(db: PrismaClient, identity: VerificationIdentity) {
  return createVerificationSubmissionService(db, identity, verificationOwner)
}
export function applicationVerificationSummary(db: PrismaClient, identity: VerificationIdentity) {
  return createVerificationSourceService(db, identity, (tx, actor, source) => source.kind === "ORDER"
    ? tx.salesOrder.findFirst({ where: { AND: [salesOrderRecordScope(actor), { id: source.id }] }, select: { id: true } })
    : tx.crmOpportunity.findFirst({ where: { AND: [opportunityScope(actor), { id: source.id }] }, select: { id: true } }))
}
