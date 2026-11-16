import { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { BusinessError } from "@/platform/policy"
import { permits } from "@/platform/access/policy"
import { accountScope, contactScope } from "@/modules/crm/policy"
import type { VerificationQueueQuery } from "@/platform/verification/review-contracts"

// Native subject visibility applies the directory's office, ownership and sharing
// rules before counting or paging. No bypass, unbounded ID list or per-row query.
// Canonical application scopes also recheck the bounded page before disclosure.
export async function readVerificationReviewQueue(
  tx: Prisma.TransactionClient,
  actor: BusinessActor,
  query: VerificationQueueQuery
) {
  const filter = Prisma.sql`s."tenantId"=${actor.tenantId}
    AND app.verification_subject_visible(c."tenantId", c."contactId", c."accountId")
    AND (person.id IS NOT NULL AND NOT person.archived OR business.id IS NOT NULL AND NOT business.archived)
    AND NOT EXISTS(SELECT 1 FROM "VerificationSubmission" newer WHERE newer."tenantId"=s."tenantId" AND newer."caseId"=s."caseId" AND newer.role=s.role AND newer.number>s.number)
    AND NOT EXISTS(SELECT 1 FROM "VerificationReview" review WHERE review."tenantId"=s."tenantId" AND review."submissionId"=s.id)
    ${query.kind ? Prisma.sql`AND c.${Prisma.raw(query.kind === "PERSON" ? '"contactId"' : '"accountId"')} IS NOT NULL` : Prisma.empty}
    ${query.role ? Prisma.sql`AND s.role=${query.role}` : Prisma.empty}
    ${query.search ? Prisma.sql`AND strpos(lower(coalesce(person.name,business.name,'')),lower(${query.search}))>0` : Prisma.empty}`
  const from = Prisma.sql`FROM "VerificationSubmission" s JOIN "CustomerVerificationCase" c ON c."tenantId"=s."tenantId" AND c.id=s."caseId"
    LEFT JOIN "CrmContact" person ON person."tenantId"=c."tenantId" AND person.id=c."contactId"
    LEFT JOIN "CrmAccount" business ON business."tenantId"=c."tenantId" AND business.id=c."accountId" WHERE ${filter}`
  const [count] = await tx.$queryRaw<{ total: number }[]>(
    Prisma.sql`SELECT count(*)::integer total ${from}`
  )
  const total = count.total,
    page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)))
  const rows = await tx.$queryRaw<
    {
      id: string
      number: number
      policyVersion: number
      role: string
      submittedAt: Date
      contactId: string | null
      accountId: string | null
    }[]
  >(Prisma.sql`
    SELECT s.id,s.number,s."policyVersion",s.role,s."submittedAt",c."contactId",c."accountId" ${from}
    ORDER BY s."submittedAt",s.id LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`)
  const people = permits(actor, "contacts.read")
    ? await tx.crmContact.findMany({
        where: {
          AND: [
            contactScope(actor, "read"),
            { id: { in: rows.flatMap((r) => (r.contactId ? [r.contactId] : [])) } }
          ]
        },
        select: { id: true, name: true }
      })
    : []
  const businesses = permits(actor, "accounts.read")
    ? await tx.crmAccount.findMany({
        where: {
          AND: [
            accountScope(actor, "read"),
            { id: { in: rows.flatMap((r) => (r.accountId ? [r.accountId] : [])) } }
          ]
        },
        select: { id: true, name: true }
      })
    : []
  return {
    page,
    pageSize: query.pageSize,
    total,
    rows: rows.map((row) => {
      const source = (row.contactId ? people : businesses).find(
        (s) => s.id === (row.contactId ?? row.accountId)
      )
      if (!source)
        throw new BusinessError(409, "Customer access changed. Refresh the review queue.")
      return {
        id: row.id,
        number: row.number,
        policyVersion: row.policyVersion,
        role: row.role,
        submittedAt: row.submittedAt,
        subject: {
          kind: row.contactId ? ("PERSON" as const) : ("BUSINESS" as const),
          id: source.id
        },
        name: source.name
      }
    })
  }
}
