import type { FieldContext, FieldResource } from "@/platform/custom-fields/resources"
import { BusinessError } from "@/platform/policy"
import { managesFields } from "@/platform/custom-fields/values"
import { termText } from "@/platform/terminology/message"

const scopeLabels = {
  ENQUIRY: termText("crm.enquiry.plural", "Enquiries"),
  OPPORTUNITY: termText("crm.opportunity.plural", "Opportunities"),
  SALES: [termText("crm.enquiry.plural", "Enquiries"), " and ", termText("crm.opportunity.plural", "opportunities")],
}

const salesContext: FieldContext = {
  teamScoped: true,
  async validate(tx, actor, salesTeamId, mode) {
    if (!salesTeamId) return
    const team = await tx.businessTeam.findFirst({ where: {
      tenantId: actor.tenantId, id: salesTeamId,
      ...(mode === "form" && !managesFields(actor) ? { members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } : {}),
    }, select: { archived: true } })
    if (mode === "form") {
      if (!team) throw new BusinessError(404, "Sales team not found.")
    } else if (!team || (mode === "create" && team.archived)) throw new BusinessError(400, "Choose an active sales team.")
  },
}
export const enquiryFields: FieldResource = {
  scopeLabels,
  key: "enquiry", permissionResource: "enquiries", label: "Enquiries", module: "crm", table: "CrmEnquiryFieldValue", scopes: ["ENQUIRY", "SALES"], context: salesContext,
  async recordTeams(tx, actor, ids) {
    const rows = await tx.crmEnquiry.findMany({ where: { tenantId: actor.tenantId, id: { in: ids } }, select: { id: true, salesTeamId: true } })
    return new Map(rows.map(row => [row.id, row.salesTeamId]))
  },
}
export const opportunityFields: FieldResource = {
  scopeLabels,
  key: "opportunity", permissionResource: "opportunities", label: "Opportunities", module: "crm", table: "CrmOpportunityFieldValue", scopes: ["OPPORTUNITY", "SALES"], context: salesContext,
  async recordTeams(tx, actor, ids) {
    const rows = await tx.crmOpportunity.findMany({ where: { tenantId: actor.tenantId, id: { in: ids } }, select: { id: true, salesTeamId: true } })
    return new Map(rows.map(row => [row.id, row.salesTeamId]))
  },
}
