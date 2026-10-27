import { Prisma } from "@prisma/client"
import { introductionWhere, responsibleUserWhere } from "@/platform/collaborators/report-scope"
import { hasIntroductionFilter, type AttributionFilter } from "@/platform/collaborators/report-validation"
import { requirePermission } from "@/platform/access/policy"
import { enquiryScope, opportunityScope, type CrmActor } from "./policy"

export function workAttributionWhere(actor: CrmActor, q: AttributionFilter): Prisma.CrmTaskWhereInput {
  const assigned = { assignee: responsibleUserWhere(q) }
  if (!hasIntroductionFilter(q)) return assigned
  requirePermission(actor, ["enquiries.read", "opportunities.read"])
  return { AND: [assigned, { OR: [
    { enquiry: { AND: [enquiryScope(actor, "read"), introductionWhere(q)] } },
    { opportunity: { AND: [opportunityScope(actor, "read"), introductionWhere(q)] } },
    ...(q.introduction === "unattributed" ? [{ enquiryId: null, opportunityId: null }] : []),
  ] }] }
}
