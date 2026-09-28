import { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { PropertyContextInput } from "./sales-validation"
import { enquiryScope, canManageCrm } from "@/modules/crm/policy"
import { projectListSchema } from "./validation"

type Tx = Prisma.TransactionClient
type Kind = "enquiry" | "opportunity"
const brief = { id: true, name: true, code: true, archived: true } as const
const include = { project: { select: brief }, subproject: { select: brief } } as const
export const realEstateEnabled = async (tx: Tx, tenantId: string) => !!(await tx.tenantModule.findUnique({ where: { tenantId_key: { tenantId, key: "realEstate" } } }))?.enabled
export async function projectFilterChoices(tx: Tx, actor: BusinessActor, input: unknown) {
  if (!await realEstateEnabled(tx, actor.tenantId)) throw new BusinessError(403, "Real Estate is not enabled.")
  const query = projectListSchema.parse(input)
  const linked = { OR: [
    { enquiryContexts: { some: { enquiry: enquiryScope(actor) } } }, { subEnquiryContexts: { some: { enquiry: enquiryScope(actor) } } },
    { opportunityContexts: { some: { opportunity: enquiryScope(actor) } } }, { subOpportunityContexts: { some: { opportunity: enquiryScope(actor) } } },
  ] }
  const where: Prisma.RealEstateProjectWhereInput = { tenantId: actor.tenantId, parentId: query.parentId || null, name: { contains: query.q, mode: "insensitive" },
    ...(!canManageCrm(actor.role) ? { OR: [linked, { archived: false, members: { some: { tenantId: actor.tenantId, userId: actor.userId } } }, { archived: false, parent: { archived: false, members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } }] } : {}),
  }
  const [items, total] = await Promise.all([tx.realEstateProject.findMany({ where, select: brief, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.realEstateProject.count({ where })])
  return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
}
export async function requirePropertyFilter(tx: Tx, actor: BusinessActor, query: { projectId?: string; subprojectId?: string }) {
  if ((query.projectId || query.subprojectId) && !await realEstateEnabled(tx, actor.tenantId)) throw new BusinessError(403, "Enable Real Estate to filter by project.")
  if (query.subprojectId && !query.projectId) throw new BusinessError(400, "Select a project before a subproject.")
  return query.projectId ? { projectId: query.projectId, ...(query.subprojectId ? { subprojectId: query.subprojectId } : {}) } : undefined
}

// Only call after the containing CRM records have passed their own access scope.
// Linked context is read-only evidence, never permission to browse the project.
export async function withPropertyContext<T extends { id: string }>(tx: Tx, actor: BusinessActor, kind: Kind, records: T[]) {
  const enabled = await realEstateEnabled(tx, actor.tenantId)
  const ids = records.map(row => row.id)
  const contexts = !enabled || !ids.length ? [] : kind === "enquiry"
    ? await tx.realEstateEnquiryContext.findMany({ where: { tenantId: actor.tenantId, enquiryId: { in: ids } }, include })
    : await tx.realEstateOpportunityContext.findMany({ where: { tenantId: actor.tenantId, opportunityId: { in: ids } }, include })
  return records.map(record => ({ ...record, realEstateEnabled: enabled, propertyContext: contexts.find(context => ("enquiryId" in context ? context.enquiryId : context.opportunityId) === record.id) || null }))
}

export async function savePropertyContext(tx: Tx, actor: BusinessActor, kind: Kind, id: string, input: PropertyContextInput | null | undefined) {
  if (input === undefined) return // Old callers and disabled-module edits preserve links.
  if (!await realEstateEnabled(tx, actor.tenantId)) throw new BusinessError(403, "Enable Real Estate before changing property context.")
  const before = kind === "enquiry"
    ? await tx.realEstateEnquiryContext.findUnique({ where: { tenantId_enquiryId: { tenantId: actor.tenantId, enquiryId: id } } })
    : await tx.realEstateOpportunityContext.findUnique({ where: { tenantId_opportunityId: { tenantId: actor.tenantId, opportunityId: id } } })
  const projectId = input?.projectId || null, subprojectId = input?.subprojectId || null
  if (projectId && (projectId !== before?.projectId || (subprojectId && subprojectId !== before?.subprojectId))) {
    const project = await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: projectId, parentId: null, archived: false,
      ...(actor.role === "STAFF" ? { members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } : {}),
    } })
    if (!project) throw new BusinessError(400, "Choose an active project you can access.")
    if (subprojectId && !await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: subprojectId, parentId: projectId, archived: false } })) throw new BusinessError(400, "Choose an active subproject belonging to this project.")
  }
  const budgetMin = input?.budgetMin ? new Prisma.Decimal(input.budgetMin) : null
  const budgetMax = input?.budgetMax ? new Prisma.Decimal(input.budgetMax) : null
  if ((budgetMin || budgetMax) && !input?.budgetCurrency) throw new BusinessError(400, "Choose a currency for the budget.")
  if (budgetMin && budgetMax && budgetMin.greaterThan(budgetMax)) throw new BusinessError(400, "Maximum budget must be at least the minimum budget.")
  const data = { projectId, subprojectId, budgetMin, budgetMax, budgetCurrency: input?.budgetCurrency || null, propertyCategory: input?.propertyCategory || null, bedrooms: input?.bedrooms ?? null, buyingTimeframe: input?.buyingTimeframe || null }
  if (kind === "enquiry") {
    if (input === null) await tx.realEstateEnquiryContext.deleteMany({ where: { tenantId: actor.tenantId, enquiryId: id } })
    else await tx.realEstateEnquiryContext.upsert({ where: { tenantId_enquiryId: { tenantId: actor.tenantId, enquiryId: id } }, create: { tenantId: actor.tenantId, enquiryId: id, ...data }, update: data })
  } else {
    if (input === null) await tx.realEstateOpportunityContext.deleteMany({ where: { tenantId: actor.tenantId, opportunityId: id } })
    else await tx.realEstateOpportunityContext.upsert({ where: { tenantId_opportunityId: { tenantId: actor.tenantId, opportunityId: id } }, create: { tenantId: actor.tenantId, opportunityId: id, ...data }, update: data })
  }
  await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: `realEstate.${kind}.context.updated`, entityType: kind === "enquiry" ? "CrmEnquiry" : "CrmOpportunity", entityId: id,
    before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(input === null ? null : data)),
  })
  const event = `realEstate.${kind}.context.updated`, message = input === null ? "Property context cleared." : "Project selection or property requirements updated."
  if (kind === "enquiry") await tx.crmActivity.create({ data: { tenantId: actor.tenantId, enquiryId: id, actorUserId: actor.userId, event, message } })
  else await tx.crmOpportunityActivity.create({ data: { tenantId: actor.tenantId, opportunityId: id, actorUserId: actor.userId, event, message } })
}

// A narrow copy within the existing conversion transaction, including archived
// links and module-off conversions. It neither selects new projects nor widens access.
export async function copyPropertyContext(tx: Tx, actor: BusinessActor, enquiryId: string, opportunityId: string) {
  const source = await tx.realEstateEnquiryContext.findUnique({ where: { tenantId_enquiryId: { tenantId: actor.tenantId, enquiryId } } })
  if (!source) return
  const { enquiryId: sourceId, ...data } = source
  await tx.realEstateOpportunityContext.create({ data: { ...data, opportunityId } })
  await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "realEstate.opportunity.context.copied", entityType: "CrmOpportunity", entityId: opportunityId, after: { sourceEnquiryId: sourceId } })
}
