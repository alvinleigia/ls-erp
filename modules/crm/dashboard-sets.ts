import { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import { ownedRecordSql } from "@/platform/access/record-scope"
import { introductionSql, responsibleUserSql } from "@/platform/collaborators/report-scope"
import { hasIntroductionFilter, type AttributionFilter } from "@/platform/collaborators/report-validation"
import type { DashboardPeriod } from "@/types/dashboard"
import { workScopeSql } from "./work-scope"

export function crmDashboardSets(actor:BusinessActor,flags:ModuleFlag[],period:DashboardPeriod,filter:AttributionFilter={}) {
  const crm=moduleEnabled(flags,"crm") && permits(actor,"reports.read")
  const leads=crm && permits(actor,"enquiries.read"),deals=crm && permits(actor,"opportunities.read")
  const work=crm && permits(actor,"activities.read") && (!hasIntroductionFilter(filter) || (permits(actor,"enquiries.read") && permits(actor,"opportunities.read")))
  const source=(resource:"enquiries"|"opportunities",alias:string) => permits(actor,`${resource}.read`) ? Prisma.sql`${Prisma.raw(alias)}.id IS NOT NULL AND ${ownedRecordSql(actor,resource,alias,"read")}` : Prisma.sql`FALSE`
  const enquiries=leads ? Prisma.sql`SELECT e.*,u.name AS owner,e."introducedByCollaboratorId" AS partner,e."partnerAttribution" AS evidence,
    ${deals ? Prisma.sql`EXISTS(SELECT 1 FROM "CrmOpportunity" o WHERE o."tenantId"=e."tenantId" AND o."enquiryId"=e.id AND ${ownedRecordSql(actor,"opportunities","o","read")})` : Prisma.sql`NULL::boolean`} AS converted
    FROM "CrmEnquiry" e JOIN "User" u ON u."tenantId"=e."tenantId" AND u.id=e."assignedUserId"
    WHERE e."tenantId"=${actor.tenantId} AND ${ownedRecordSql(actor,"enquiries","e","read")} AND ${responsibleUserSql(filter,"u")} AND ${introductionSql(filter,"e")}
    AND e."createdAt">=${period.start} AND e."createdAt"<${period.end}` : null
  const sales=Prisma.sql`SELECT o.*,u.name AS owner,o."introducedByCollaboratorId" AS partner,o."partnerAttribution" AS evidence,st.name AS "stageName",pl.name AS "pipelineName"
    FROM "CrmOpportunity" o JOIN "User" u ON u."tenantId"=o."tenantId" AND u.id=o."assignedUserId"
    JOIN "CrmStage" st ON st."tenantId"=o."tenantId" AND st.id=o."stageId"
    JOIN "CrmPipeline" pl ON pl."tenantId"=o."tenantId" AND pl.id=o."pipelineId"
    JOIN "CrmContact" c ON c."tenantId"=o."tenantId" AND c.id=o."contactId"
    WHERE o."tenantId"=${actor.tenantId} AND ${ownedRecordSql(actor,"opportunities","o","read")} AND ${responsibleUserSql(filter,"u")} AND ${introductionSql(filter,"o")}`
  const tasks=Prisma.sql`SELECT t.*,u.name AS owner,
    CASE WHEN ${source("enquiries","e")} THEN e."introducedByCollaboratorId" WHEN ${source("opportunities","o")} THEN o."introducedByCollaboratorId" END AS partner,
    CASE WHEN ${source("enquiries","e")} THEN e."partnerAttribution" WHEN ${source("opportunities","o")} THEN o."partnerAttribution" END AS evidence
    FROM "CrmTask" t JOIN "User" u ON u."tenantId"=t."tenantId" AND u.id=t."assignedUserId"
    LEFT JOIN "CrmEnquiry" e ON e."tenantId"=t."tenantId" AND e.id=t."enquiryId"
    LEFT JOIN "CrmOpportunity" o ON o."tenantId"=t."tenantId" AND o.id=t."opportunityId"
    WHERE ${workScopeSql(actor,"t")} AND ${responsibleUserSql(filter,"u")}
    ${hasIntroductionFilter(filter) ? Prisma.sql`AND ((${source("enquiries","e")} AND ${introductionSql(filter,"e")}) OR (${source("opportunities","o")} AND ${introductionSql(filter,"o")}) ${filter.introduction==="unattributed" ? Prisma.sql`OR (t."enquiryId" IS NULL AND t."opportunityId" IS NULL)` : Prisma.empty})` : Prisma.empty}`
  const pending=work ? Prisma.sql`${tasks} AND t.status IN ('OPEN','IN_PROGRESS')` : null
  const completed=work ? Prisma.sql`${tasks} AND t.status='COMPLETED' AND t."completedAt">=${period.start} AND t."completedAt"<${period.end}` : null
  return {
    enquiries,converted:enquiries && deals ? Prisma.sql`SELECT * FROM (${enquiries}) s WHERE converted` : null,
    pipeline:deals ? Prisma.sql`${sales} AND st.kind='OPEN' AND NOT st.archived AND NOT pl.archived AND NOT c.archived` : null,
    won:deals ? Prisma.sql`${sales} AND st.kind='WON' AND o."closedAt">=${period.start} AND o."closedAt"<${period.end}` : null,
    lost:deals ? Prisma.sql`${sales} AND st.kind='LOST' AND o."closedAt">=${period.start} AND o."closedAt"<${period.end}` : null,
    openActivities:pending,completedActivities:completed,
    overdueActivities:pending ? Prisma.sql`SELECT * FROM (${pending}) s WHERE s."startsAt"<${period.now} OR (s."startsAt" IS NULL AND s."dueOn"<${new Date(`${period.today}T00:00:00Z`)})` : null,
    completedCalls:completed ? Prisma.sql`SELECT * FROM (${completed}) s WHERE type='CALL'` : null,
  }
}
