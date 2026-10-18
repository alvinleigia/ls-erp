import { termText } from "@/platform/terminology/message"
import { permits, requirePermission } from "@/platform/access/policy"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { BusinessError } from "@/platform/policy"
import { enquiryScope } from "@/modules/crm/policy"
import { emptyReportExtension, type CrmExtensions, type CrmReportExtension } from "@/modules/crm/extensions"
import type { ImportField } from "@/modules/crm/import-types"
import { propertyContextSchema } from "./sales-validation"
import { copyPropertyContext, savePropertyContext, withPropertyContext, requirePropertyFilter, projectFilterChoices, realEstateEnabled } from "./sales-context"

const querySchema = z.object({ projectId: z.string().trim().min(1).max(100).optional(), subprojectId: z.string().trim().min(1).max(100).optional() })
const writeSchema = z.object({ propertyContext: propertyContextSchema.nullable().optional() })
type Fields = Awaited<ReturnType<typeof withPropertyContext>>[number]
type Metadata = { realEstateEnabled: boolean }
const projectJoins = Prisma.sql`
  LEFT JOIN "RealEstateProject" p ON p.id = x."projectId" AND p."tenantId" = r."tenantId"
  LEFT JOIN "RealEstateProject" sp ON sp.id = x."subprojectId" AND sp."tenantId" = r."tenantId"`

export const realEstateCrmExtension: CrmExtensions<Omit<Fields, "id">, Metadata> = {
  splitQuery(input) {
    const extension = querySchema.parse(input)
    const core = { ...input as Record<string, unknown> }
    delete core.projectId; delete core.subprojectId
    return { core, extension }
  },
  async importFields(tx, actor) {
    if (!await realEstateEnabled(tx, actor.tenantId)) return []
    const canReadProjects = permits(actor, "projects.read")
    const projects = canReadProjects ? await tx.realEstateProject.findMany({ where: { tenantId: actor.tenantId, archived: false,
      ...(actor.role === "STAFF" ? { OR: [{ members: { some: { tenantId: actor.tenantId, userId: actor.userId } } }, { parent: { archived: false, members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } }] } : {}),
    }, select: { id: true, name: true, code: true, parentId: true }, orderBy: { name: "asc" }, take: 5000 }) : []
    const [categories, timeframes] = await Promise.all([
      tx.realEstatePropertyCategory.findMany({ where: { tenantId: actor.tenantId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
      tx.realEstateBuyingTimeframe.findMany({ where: { tenantId: actor.tenantId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
    ])
    return ([
      { key: "projectId", label: "Project", terminologyKey: "realEstate.project.singular", type: "choice", allowDefault: true, choices: projects.filter(p => !p.parentId).map(p => ({ ...p, aliases: [p.code] })) },
      { key: "subprojectId", label: "Subproject", terminologyKey: "realEstate.subproject.singular", type: "choice", allowDefault: true, dependsOn: "projectId", choices: projects.filter(p => p.parentId).map(p => ({ ...p, aliases: [p.code] })) },
      { key: "budgetMin", label: "Minimum budget", type: "number" }, { key: "budgetMax", label: "Maximum budget", type: "number" },
      { key: "budgetCurrency", label: "Budget currency" },
      { key: "propertyCategory", label: "Preferred property category", aliases: ["Property category"], type: "choice", choices: categories },
      { key: "bedrooms", label: "Bedrooms", type: "number" },
      { key: "buyingTimeframe", label: "Buying timeframe", type: "choice", choices: timeframes },
    ] satisfies ImportField[]).filter(field => canReadProjects || (field.key !== "projectId" && field.key !== "subprojectId"))
  },
  importInput(values) {
    const propertyContext = Object.fromEntries(["projectId", "subprojectId", "budgetMin", "budgetMax", "budgetCurrency", "propertyCategory", "bedrooms", "buyingTimeframe"].filter(k => values[k] !== undefined).map(k => [k, k === "bedrooms" ? Number(values[k]) : values[k]]))
    return Object.keys(propertyContext).length ? { propertyContext } : {}
  },
  async validateCreate(tx, actor, input) {
    await savePropertyContext(tx, actor, "enquiry", "", writeSchema.parse(input).propertyContext, true)
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
    if (writeSchema.parse(input).propertyContext !== undefined) throw new BusinessError(400, ["Conversion copies the ", termText("crm.enquiry.singular", "enquiry"), "'s property context. Edit the ", termText("crm.opportunity.singular", "opportunity"), " afterwards to change it."])
  },
  async save(tx, actor, kind, id, input) {
    await savePropertyContext(tx, actor, kind, id, writeSchema.parse(input).propertyContext)
  },
  copyOnConversion: copyPropertyContext,
  async decorate(tx, actor, kind, records, exporting) {
    const enabled = await realEstateEnabled(tx, actor.tenantId)
    const items = await withPropertyContext(tx, actor, kind, records, enabled)
    return { items, metadata: { realEstateEnabled: enabled }, exportFields: exporting && enabled ? {
      headers: ["Project", "Subproject"],
      terminologyKeys: ["realEstate.project.singular", "realEstate.subproject.singular"],
      values: Object.fromEntries(items.map(item => [item.id, [item.propertyContext?.project?.name || null, item.propertyContext?.subproject?.name || null]])),
    } : undefined }
  },
  async filters(tx, actor, query) {
    const context = await requirePropertyFilter(tx, actor, querySchema.strict().parse(query))
    if (!context) return {}
    const relation = { propertyContext: { is: context } }
    return { enquiry: relation, opportunity: relation, work: { OR: [
      { enquiry: { AND: [enquiryScope(actor), relation] } },
      { opportunity: { AND: [enquiryScope(actor), relation] } },
    ] } }
  },
  async report(tx, actor, query): Promise<CrmReportExtension> {
    const filters = querySchema.strict().parse(query)
    const enabled = await realEstateEnabled(tx, actor.tenantId)
    if (!enabled) {
      if (filters.projectId || filters.subprojectId) throw new BusinessError(403, termText("realEstate.project.singular", "Enable Real Estate to report by project.", "Enable Real Estate to report by {label}."))
      return emptyReportExtension
    }
    if (filters.subprojectId && !filters.projectId) throw new BusinessError(400, ["Select a ", termText("realEstate.project.singular", "project"), " before a ", termText("realEstate.subproject.singular", "subproject"), "."])
    return {
      values: Prisma.sql`jsonb_build_object('projectId', x."projectId", 'project', p.name, 'subproject', sp.name)`,
      columns: [{ key: "project", label: "Project", terminologyKey: "realEstate.project.singular" }, { key: "subproject", label: "Subproject", terminologyKey: "realEstate.subproject.singular" }],
      dimensions: [{ key: "project", label: "Project", terminologyKey: "realEstate.project.singular", emptyLabel: "No project", value: Prisma.sql`"extensionValues"->>'projectId'`, display: Prisma.sql`"extensionValues"->>'project'` }],
      enquiryJoins: Prisma.sql`LEFT JOIN "RealEstateEnquiryContext" x ON x."enquiryId" = r.id AND x."tenantId" = r."tenantId" ${projectJoins}`,
      opportunityJoins: Prisma.sql`LEFT JOIN "RealEstateOpportunityContext" x ON x."opportunityId" = r.id AND x."tenantId" = r."tenantId" ${projectJoins}`,
      filter: Prisma.sql`${filters.projectId ? Prisma.sql`AND x."projectId" = ${filters.projectId}` : Prisma.empty}
        ${filters.subprojectId ? Prisma.sql`AND x."subprojectId" = ${filters.subprojectId}` : Prisma.empty}`,
    }
  },
  async choices(tx, actor, key, input) {
    if (key !== "projects") throw new BusinessError(404, "Unknown Real Estate choice list.")
    requirePermission(actor, "projects.read")
    return projectFilterChoices(tx, actor, input)
  },
}
