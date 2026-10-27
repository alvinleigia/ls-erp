import { Prisma } from "@prisma/client"
import type { AttributionFilter } from "./report-validation"

export function responsibleUserWhere(q: AttributionFilter): Prisma.UserWhereInput {
  return q.responsibleType === "external" ? { collaboratorId: { not: null } } : q.responsibleType === "internal" ? { collaboratorId: null } : {}
}
export function introductionWhere(q: AttributionFilter) {
  return {
    ...(q.introduction === "partner" ? { introducedByCollaboratorId: { not: null } } : q.introduction === "unattributed" ? { introducedByCollaboratorId: null } : {}),
    ...(q.introducedByCollaboratorId ? { introducedByCollaboratorId: q.introducedByCollaboratorId } : {}),
    ...(q.introductionSupervisorId ? { partnerAttribution: { path: ["supervisorUserId"], equals: q.introductionSupervisorId } } : {}),
  }
}
const alias = (value: string) => { if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw Error("Invalid attribution alias");return Prisma.raw(value) }
export function responsibleUserSql(q: AttributionFilter, userAlias: string) {
  const u = alias(userAlias)
  return q.responsibleType === "external" ? Prisma.sql`${u}."collaboratorId" IS NOT NULL` : q.responsibleType === "internal" ? Prisma.sql`${u}."collaboratorId" IS NULL` : Prisma.sql`TRUE`
}
export function introductionSql(q: AttributionFilter, sourceAlias: string) {
  const r = alias(sourceAlias)
  return Prisma.sql`TRUE
    ${q.introduction === "partner" ? Prisma.sql`AND ${r}."introducedByCollaboratorId" IS NOT NULL` : q.introduction === "unattributed" ? Prisma.sql`AND ${r}."introducedByCollaboratorId" IS NULL` : Prisma.empty}
    ${q.introducedByCollaboratorId ? Prisma.sql`AND ${r}."introducedByCollaboratorId"=${q.introducedByCollaboratorId}` : Prisma.empty}
    ${q.introductionSupervisorId ? Prisma.sql`AND ${r}."partnerAttribution"->>'supervisorUserId'=${q.introductionSupervisorId}` : Prisma.empty}`
}
