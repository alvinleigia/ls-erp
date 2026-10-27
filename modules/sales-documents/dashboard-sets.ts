import { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import { ownedRecordSql, sharingGrantSql } from "@/platform/access/record-scope"
import { introductionSql, responsibleUserSql } from "@/platform/collaborators/report-scope"
import { hasIntroductionFilter, type AttributionFilter } from "@/platform/collaborators/report-validation"
import type { DashboardPeriod } from "@/types/dashboard"

export function documentDashboardSets(actor:BusinessActor,flags:ModuleFlag[],period:DashboardPeriod,filter:AttributionFilter={}) {
  const readableSource=permits(actor,"opportunities.read")
  const quotes=moduleEnabled(flags,"salesDocuments") && permits(actor,"quotations.read") && (!hasIntroductionFilter(filter)||readableSource)
  const source=readableSource ? ownedRecordSql(actor,"opportunities","o","read") : Prisma.sql`FALSE`
  const documents=Prisma.sql`SELECT q.*,CASE WHEN ${source} THEN u.name END AS owner,
    CASE WHEN ${source} THEN o."introducedByCollaboratorId" END AS partner,
    CASE WHEN ${source} THEN o."partnerAttribution" END AS evidence
    FROM "CrmQuotation" q JOIN "CrmOpportunity" o ON o."tenantId"=q."tenantId" AND o.id=q."opportunityId"
    JOIN "User" u ON u."tenantId"=o."tenantId" AND u.id=o."assignedUserId"
    WHERE q."tenantId"=${actor.tenantId} AND (${ownedRecordSql(actor,"quotations","o","read")} OR ${sharingGrantSql(actor,"quotations","q","read")})
    AND ${responsibleUserSql(filter,"u")} AND ${introductionSql(filter,"o")}
    ${hasIntroductionFilter(filter) ? Prisma.sql`AND ${source}` : Prisma.empty}`
  const plans=quotes && moduleEnabled(flags,"paymentPlans") ? Prisma.sql`SELECT d.*,r.snapshot->'calculation'->'instalments' AS schedule
    FROM (${documents}) d JOIN "CrmQuotationRevision" r ON r."tenantId"=d."tenantId" AND r."quotationId"=d.id AND r.number=d.version
    WHERE jsonb_array_length(COALESCE(r.snapshot->'calculation'->'instalments','[]'::jsonb))>0` : null
  const instalments=plans ? Prisma.sql`SELECT d.id||':'||i.ordinality::text AS id,d.id AS "documentId",d.title,d.owner,d.currency,d."createdAt",d.partner,d.evidence,
    i.value->>'label' AS label,i.value->>'dueDate' AS "dueDate",i.value->>'amount' AS amount,i.ordinality AS position
    FROM (${plans}) d CROSS JOIN LATERAL jsonb_array_elements(d.schedule) WITH ORDINALITY i(value,ordinality)` : null
  return {
    quotations:quotes ? Prisma.sql`${documents} AND q."createdAt">=${period.start} AND q."createdAt"<${period.end}` : null,
    planDocuments:plans,
    upcomingInstalments:instalments ? Prisma.sql`SELECT * FROM (${instalments}) s WHERE "dueDate">=${period.today} AND "dueDate"<to_char(${new Date(`${period.today}T00:00:00Z`)}::date+30,'YYYY-MM-DD')` : null,
    undatedInstalments:instalments ? Prisma.sql`SELECT * FROM (${instalments}) s WHERE COALESCE("dueDate",'')=''` : null,
  }
}
