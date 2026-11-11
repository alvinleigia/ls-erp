import { partnerChoiceQuery, changePartner, partnerActions } from "@/platform/collaborators/relationships"
import { requirePermission } from "@/platform/access/policy"
import { BusinessError } from "@/platform/policy"
import type { CrmServiceContext } from "./service-context"
import { enquiryScope, opportunityScope } from "./policy"
import type { PermissionAction } from "@/platform/access/catalog"
import type { PermissionRun } from "@/platform/access/server"

export function createCrmPartnerService({ run, runLocked, audit }: CrmServiceContext & { runLocked: PermissionRun }) {
  return {
    partnerChoices(input: unknown) {
      const q = partnerChoiceQuery.parse(input)
      return run("partnerChoices.read", async (tx, actor) => {
        const [result] = await tx.$queryRaw<{ result: { items: { id: string; name: string; code: string; classification: string }[]; total: number } }[]>`SELECT app.partner_choices(${actor.tenantId},${q.q},${q.pageSize}::integer,${(q.page - 1) * q.pageSize}::integer) AS result`
        return { ...result.result, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(result.result.total / q.pageSize)) }
      })
    },
    partnerLink(kind: "enquiries" | "opportunities", id: string, input?: unknown) {
      const writing = input !== undefined
      return (writing ? runLocked : run)(writing ? `${kind}.edit` : [`${kind}.read`, "partnerLinks.read"], async (tx, actor) => {
        const enquiryWhere = (action: PermissionAction) => ({ ...enquiryScope(actor, action), id })
        const opportunityWhere = (action: PermissionAction) => ({ ...opportunityScope(actor, action), id })
        const select = { id: true, version: true, introducedByCollaboratorId: true, partnerAttribution: true }
        // Identical native fields; each delegate still applies its source RLS.
        const find = (action: PermissionAction) => kind === "enquiries" ? tx.crmEnquiry.findFirst({ where: enquiryWhere(action), select }) : tx.crmOpportunity.findFirst({ where: opportunityWhere(action), select })
        const before = await find(writing ? "edit" : "read")
        if (!before) throw new BusinessError(404, "Record not found within your access.")
        if (writing) {
          requirePermission(actor, `${kind}.read`)
          const change = await changePartner(tx, actor, before, input, async (partnerId, version) => {
            const update = { data: { introducedByCollaboratorId: partnerId, version: { increment: 1 } }, select }
            const rows = kind === "enquiries" ? await tx.crmEnquiry.updateManyAndReturn({ ...update, where: { ...enquiryWhere("edit"), version } }) : await tx.crmOpportunity.updateManyAndReturn({ ...update, where: { ...opportunityWhere("edit"), version } })
            return rows[0] ?? null
          })
          const describe = (e: typeof before) => e.partnerAttribution as { name?: string; code?: string } | null
          const label = (e: typeof before) => describe(e)?.name || "No partner recorded"
          const message = `Introducing partner: ${label(before)} -> ${label(change.after)}. Reason: ${change.reason}`
          if (kind === "enquiries") await tx.crmActivity.create({ data: { tenantId: actor.tenantId, enquiryId: id, actorUserId: actor.userId, event: "partner.changed", message } })
          else await tx.crmOpportunityActivity.create({ data: { tenantId: actor.tenantId, opportunityId: id, actorUserId: actor.userId, event: "crm.opportunity.partner.changed", message } })
          await audit(tx, actor, kind === "enquiries" ? "crm.enquiry.partner.changed" : "crm.opportunity.partner.changed", id, { partnerAttribution: before.partnerAttribution }, { partnerAttribution: change.after.partnerAttribution, reason: change.reason })
          return change.after
        }
        const editable = !!await find("edit")
        const history = await tx.crmPartnerLinkEvent.findMany({ where: { tenantId: actor.tenantId, ...(kind === "enquiries" ? { enquiryId: id } : { opportunityId: id }) }, orderBy: [{ recordVersion: "desc" }, { id: "desc" }], take: 50, select: { id: true, before: true, after: true, reason: true, createdAt: true, actor: { select: { name: true } } } })
        return { ...before, ...partnerActions(actor, !!before.introducedByCollaboratorId, editable && (actor.permissions === undefined || actor.permissions.includes(`${kind}.edit`))), history }
      })
    },
  }
}
