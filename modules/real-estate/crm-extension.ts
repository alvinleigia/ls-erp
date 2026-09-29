import { Prisma } from "@prisma/client"
import { z } from "zod"
import { BusinessError } from "@/platform/policy"
import { enquiryScope } from "@/modules/crm/policy"
import { emptyReportExtension, type CrmExtensions, type CrmReportExtension } from "@/modules/crm/extensions"
import { propertyContextSchema } from "./sales-validation"
import { copyPropertyContext, savePropertyContext, withPropertyContext, requirePropertyFilter, projectFilterChoices, realEstateEnabled } from "./sales-context"

const writeSchema = z.object({ propertyContext: propertyContextSchema.nullable().optional() })
type Fields = Awaited<ReturnType<typeof withPropertyContext>>[number]
type Metadata = { realEstateEnabled: boolean }
const projectJoins = Prisma.sql`
  LEFT JOIN "RealEstateProject" p ON p.id = x."projectId" AND p."tenantId" = r."tenantId"
  LEFT JOIN "RealEstateProject" sp ON sp.id = x."subprojectId" AND sp."tenantId" = r."tenantId"`

export const realEstateCrmExtension: CrmExtensions<Omit<Fields, "id">, Metadata> = {
  async quotationContext(tx, actor, opportunityId) {
    if (!await realEstateEnabled(tx, actor.tenantId)) return []
    const context = await tx.realEstateOpportunityContext.findFirst({ where: { tenantId: actor.tenantId, opportunityId }, include: { project: { select: { name: true, developerAccount: { select: { name: true } } } }, subproject: { select: { name: true } } } })
    return [
      { label: "Project", value: context?.project?.name || "" },
      { label: "Subproject", value: context?.subproject?.name || "" },
      { label: "Developer", value: context?.project?.developerAccount?.name || "" },
    ].filter(item => item.value)
  },
  splitWrite(input) {
    // Parse only the extension envelope here; core's strict schema still rejects
    // unknown fields. The envelope preserves propertyContext error paths.
    const extension = writeSchema.parse(input)
    const core = { ...input as Record<string, unknown> }
    delete core.propertyContext
    return { core, extension }
  },
  assertConversionInput(input) {
    if (writeSchema.parse(input).propertyContext !== undefined) throw new BusinessError(400, "Conversion copies the enquiry's property context. Edit the opportunity afterwards to change it.")
  },
  async save(tx, actor, kind, id, input) {
    await savePropertyContext(tx, actor, kind, id, writeSchema.parse(input).propertyContext)
  },
  copyOnConversion: copyPropertyContext,
  async decorate(tx, actor, kind, records) {
    const enabled = await realEstateEnabled(tx, actor.tenantId)
    const items = await withPropertyContext(tx, actor, kind, records, enabled)
    return { items, metadata: { realEstateEnabled: enabled } }
  },
  async filters(tx, actor, query) {
    const context = await requirePropertyFilter(tx, actor, query)
    if (!context) return {}
    const relation = { propertyContext: { is: context } }
    return { enquiry: relation, opportunity: relation, work: { OR: [
      { enquiry: { AND: [enquiryScope(actor), relation] } },
      { opportunity: { AND: [enquiryScope(actor), relation] } },
    ] } }
  },
  async report(tx, actor, query): Promise<CrmReportExtension> {
    const enabled = await realEstateEnabled(tx, actor.tenantId)
    if (!enabled) {
      if (query.projectId || query.subprojectId || query.dimension === "project") throw new BusinessError(403, "Enable Real Estate to report by project.")
      return emptyReportExtension
    }
    if (query.subprojectId && !query.projectId) throw new BusinessError(400, "Select a project before a subproject.")
    return {
      realEstateEnabled: true,
      columns: Prisma.sql`x."projectId" AS "projectId", p.name AS project, sp.name AS subproject`,
      enquiryJoins: Prisma.sql`LEFT JOIN "RealEstateEnquiryContext" x ON x."enquiryId" = r.id AND x."tenantId" = r."tenantId" ${projectJoins}`,
      opportunityJoins: Prisma.sql`LEFT JOIN "RealEstateOpportunityContext" x ON x."opportunityId" = r.id AND x."tenantId" = r."tenantId" ${projectJoins}`,
      filter: Prisma.sql`${query.projectId ? Prisma.sql`AND x."projectId" = ${query.projectId}` : Prisma.empty}
        ${query.subprojectId ? Prisma.sql`AND x."subprojectId" = ${query.subprojectId}` : Prisma.empty}`,
    }
  },
  async choices(tx, actor, key, input) {
    if (key !== "projects") throw new BusinessError(404, "Unknown Real Estate choice list.")
    return projectFilterChoices(tx, actor, input)
  },
}
