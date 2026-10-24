import { authorizeBusinessOperation } from "@/platform/access/operation"
import { recordActionAccess } from "@/platform/access/record-actions"

import { termText } from "@/platform/terminology/message"
import { projectScope } from "./access"
import { recordLimits } from "@/platform/access/rules"
export { projectScope } from "./access"
import { readTermReplacements } from "@/platform/terminology/read"
import { realEstateTerms } from "./terminology"
import { requireWriteFields, requireScopedWriteFields, permits } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"

import { requirePermission } from "@/platform/access/policy"
import { splitCustomFields } from "@/platform/custom-fields/validation"
import { readCustomFields, saveCustomFields, customFieldFilter, customFieldExport } from "@/platform/custom-fields/values"
import { projectFields } from "./custom-fields"
import { CRM_EXPORT_LIMIT, checkExportLimit } from "@/modules/crm/csv"
import { Prisma, type PrismaClient } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { accountScope } from "@/modules/crm/policy"
import { memberSchema, projectListSchema, projectSchema, projectUpdateSchema } from "./validation"
import { createPropertyChoiceService, propertyChoiceDefaults, resolvePropertyChoice, validatePropertyCategories } from "./choice-service"

type Tx = Prisma.TransactionClient
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })

// Module operations own permissions, tenant scope and audited writes. Callers
// establish the tenant database context, as for CRM services.
export function createRealEstateService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const actor = await authorizeBusinessOperation(tx, identity, requirement, ["crm","realEstate"])
          return operation(tx, actor)
        }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
      } catch (error) {
        const code = (error as { code?: string }).code
        const meta = (error as { meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }).meta
        const serialization = code === "P2034" || (code === "P2010" && (meta?.code === "40001" || meta?.driverAdapterError?.cause?.originalCode === "40001"))
        if (serialization && attempt < 2) continue
        if (serialization) throw new BusinessError(409, "This record changed. Refresh before saving.")
        if (code === "P2002" || (code === "P2010" && (meta?.code === "23505" || meta?.driverAdapterError?.cause?.originalCode === "23505"))) throw new BusinessError(409, "This code or choice already exists. Edit or restore the existing record.")
        throw error
      }
    }
  }
  async function find(tx: Tx, actor: BusinessActor, id: string) {
    const membership = actor.operation?.resource === "projectMembers"
    const record = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, membership ? "read" : undefined), ...(membership ? [projectScope(actor, actor.operation?.action, "projectMembers")] : []), { id }] } })
    if (!record) throw new BusinessError(404, termText("realEstate.project.singular", "Project not found.", "{label} not found."))
    return record
  }
  async function audit(tx: Tx, actor: BusinessActor, event: string, entityId: string, before: unknown, after: unknown) {
    await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event, entityType: "RealEstateProject", entityId, before: snapshot(before), after: snapshot(after) })
  }
  async function values(tx: Tx, actor: BusinessActor, data: ReturnType<typeof projectSchema.parse>, before?: Awaited<ReturnType<typeof find>>) {
    const defaults = !before && (!data.lifecycle || data.categories === undefined) ? await propertyChoiceDefaults(tx, actor.tenantId) : null
    const lifecycle = data.lifecycle || before?.lifecycle || defaults?.["project-statuses"]?.id
    const categories = data.categories ?? before?.categories ?? (defaults?.["property-categories"] ? [defaults["property-categories"].id] : [])
    if (!lifecycle) throw new BusinessError(400, termText("realEstate.project.singular", "Choose a project status or configure a default.", "Choose a {label} status or configure a default."))
    await resolvePropertyChoice(tx, actor.tenantId, "project-statuses", lifecycle, before?.lifecycle)
    await validatePropertyCategories(tx, actor.tenantId, categories, before?.categories)
    if (before && (data.parentId || null) !== before.parentId) throw new BusinessError(400, ["A ", termText("realEstate.project.singular", "project"), "'s parent cannot be changed. Create a ", termText("realEstate.subproject.singular", "subproject"), " under the correct ", termText("realEstate.project.singular", "project"), "."])
    if (data.parentId) {
      const parent = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor), { id: data.parentId, parentId: null }] } })
      if (!parent) throw new BusinessError(400, termText("realEstate.project.singular", "Choose a top-level project in this business.", "Choose a top-level {label} in this business."))
      if (parent.archived && (!before || !data.archived)) throw new BusinessError(409, ["Restore the parent ", termText("realEstate.project.singular", "project"), " before creating or restoring a ", termText("realEstate.subproject.singular", "subproject"), "."])
    }
    if (data.developerAccountId && data.developerAccountId !== before?.developerAccountId && !await tx.crmAccount.findFirst({ where: { tenantId: actor.tenantId, id: data.developerAccountId, archived: false } })) throw new BusinessError(400, termText("crm.account.singular", "Choose an active developer business account.", "Choose an active developer {label}."))
    const priceMin = data.priceMin ? new Prisma.Decimal(data.priceMin) : null
    const priceMax = data.priceMax ? new Prisma.Decimal(data.priceMax) : null
    if ((priceMin || priceMax) && !data.currency) throw new BusinessError(400, "Choose a currency for the indicative price range.")
    if (priceMin && priceMax && priceMin.greaterThan(priceMax)) throw new BusinessError(400, "Maximum price must be at least the minimum price.")
    const teamId = data.teamId === undefined ? before?.teamId ?? null : data.teamId || null
    if (teamId && data.parentId) throw new BusinessError(400, "Subprojects inherit their parent's team.")
    if (teamId && teamId !== before?.teamId) {
      requirePermission(actor, "projects.assign")
      if (recordLimits(actor, "projects", "assign").length !== 0 && !actor.managedTeamIds?.includes(teamId)) throw new BusinessError(403, "Choose a team you manage.")
      if (!await tx.businessTeam.findFirst({ where: { tenantId: actor.tenantId, id: teamId, archived: false } })) throw new BusinessError(400, "Choose an active team in this business.")
    }
    if (before?.teamId && teamId !== before.teamId) requirePermission(actor, "projects.assign")
    return { ...data, teamId, lifecycle, categories: [...new Set(categories)], parentId: data.parentId || null, developerAccountId: data.developerAccountId || null, priceMin, priceMax, currency: data.currency || null }
  }
  return {
    ...createPropertyChoiceService(run),
    listProjects(input: unknown, exporting = false) {
      const query = projectListSchema.parse(input)
      return run(exporting ? ["projects.read", "projects.export"] : "projects.read", async (tx, actor) => {
        if (query.parentId) await find(tx, actor, query.parentId)
        const where: Prisma.RealEstateProjectWhereInput = { AND: [projectScope(actor), {
          ...await customFieldFilter(tx, actor, projectFields, query),
          parentId: query.parentId || null, archived: query.archived === "true", ...(query.lifecycle ? { lifecycle: query.lifecycle } : {}),
          ...(query.q ? { OR: ["name", "code", "location"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {}),
        }] }
        const [items, total] = await Promise.all([tx.realEstateProject.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: exporting ? 0 : (query.page - 1) * query.pageSize, take: exporting ? CRM_EXPORT_LIMIT : query.pageSize,
          select: { id: true, parentId: true, name: true, code: true, location: true, lifecycle: true, lifecycleName: true, categoryNames: true, archived: true, version: true, categories: true, priceMin: true, priceMax: true, currency: true } }), tx.realEstateProject.count({ where })])
        if (exporting) checkExportLimit(total)
        return { ...pageResult(items, total, query.page, query.pageSize), canManage: permits(actor, "projects.edit"), exportTerms: exporting ? await readTermReplacements(tx, actor.tenantId, realEstateTerms) : undefined, customFieldExport: exporting ? await customFieldExport(tx, actor, projectFields, items.map(item => item.id)) : undefined }
      })
    },
    getProject(id: string) {
      return run("projects.read", async (tx, actor) => {
        const record = await find(tx, actor, id)
        const team = record.teamId ? await tx.businessTeam.findFirst({ where: { tenantId: actor.tenantId, id: record.teamId }, select: { id: true, name: true } }) : null
        const developerAccount = record.developerAccountId ? await tx.crmAccount.findFirst({ where: { AND: [accountScope(actor), { id: record.developerAccountId }] }, select: { id: true, name: true } }) : null
        const parent = record.parentId ? await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: record.parentId }, select: { id: true, name: true, archived: true } }) : null
        const recordAccess = await recordActionAccess(actor, "projects", action => tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, action), { id }] }, select: { id: true } }))
        const membersAccess = await recordActionAccess(actor, "projectMembers", action => tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, "read"), projectScope(actor, action, "projectMembers"), { id }] }, select: { id: true } }))
        Object.assign(recordAccess.permissions, membersAccess.permissions)
        return { ...record, team, recordAccess, customFields: await readCustomFields(tx, actor, projectFields, record), developerAccountId: developerAccount?.id || null, developerAccount, developerRestricted: !!record.developerAccountId && !developerAccount, parent, canManage: !!recordAccess.permissions["projects.edit"] }
      })
    },
    createProject(input: unknown) {
      const custom = splitCustomFields(input)
      const data = projectSchema.parse(custom.core)
      return run("projects.create", async (tx, actor) => { requireWriteFields(actor, "projects", undefined, data);
        const record = await tx.realEstateProject.create({ data: { ...await values(tx, actor, data), tenantId: actor.tenantId } })
        if (!record.parentId && recordLimits(actor, "projects", "create").length !== 0) await tx.realEstateProjectMember.create({ data: { tenantId: actor.tenantId, projectId: record.id, userId: actor.userId } })
        await saveCustomFields(tx, actor, projectFields, record, custom.patch, true)
        await audit(tx, actor, "realEstate.project.created", record.id, null, record)
        return record
      })
    },
    updateProject(id: string, input: unknown) {
      const custom = splitCustomFields(input)
      const { version, ...data } = projectUpdateSchema.parse(custom.core)
      return run("projects.edit", async (tx, actor) => {
        const before = await find(tx, actor, id)
        await requireScopedWriteFields(actor, "projects", before ?? undefined, data, async action => { if (!await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, action), { id }] }, select: { id: true } })) throw new BusinessError(403, "This action is outside your record access.") })
        const next = await values(tx, actor, data, before)
        const changed = await tx.realEstateProject.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...next, version: { increment: 1 } } })
        if (!changed.count) throw new BusinessError(409, termText("realEstate.project.singular", "This project changed. Refresh before saving.", "This {label} changed. Refresh before saving."))
        // The write was scoped above. Return its result even if archiving removes
        // this record from the caller's active-only read policy.
        const record = await tx.realEstateProject.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } })
        await saveCustomFields(tx, actor, projectFields, record, custom.patch)
        await audit(tx, actor, "realEstate.project.updated", id, before, record)
        return record
      })
    },
    listMembers(id: string, input: unknown) {
      const query = projectListSchema.parse(input)
      return run("projectMembers.read", async (tx, actor) => {
        const project = await find(tx, actor, id)
        const where = { tenantId: actor.tenantId, projectId: project.parentId || project.id }
        const [rows, total] = await Promise.all([tx.realEstateProjectMember.findMany({ where, include: { user: { select: { id: true, name: true, status: true, role: true } } }, orderBy: { userId: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.realEstateProjectMember.count({ where })])
        return { ...pageResult(rows.map(row => row.user), total, query.page, query.pageSize), version: project.version }
      })
    },
    changeMember(id: string, input: unknown) {
      const { userId, version, remove } = memberSchema.parse(input)
      return run("projectMembers.assign", async (tx, actor) => {
        const project = await find(tx, actor, id)
        if (project.parentId || project.archived) throw new BusinessError(409, termText("realEstate.project.singular", "Manage staff access on an active top-level project.", "Manage staff access on an active top-level {label}."))
        if (!remove && !await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } } })) throw new BusinessError(400, "Choose an active staff member in this business.")
        const changed = await tx.realEstateProject.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { version: { increment: 1 } } })
        if (!changed.count) throw new BusinessError(409, termText("realEstate.project.singular", "This project changed. Refresh before saving.", "This {label} changed. Refresh before saving."))
        if (remove) await tx.realEstateProjectMember.deleteMany({ where: { tenantId: actor.tenantId, projectId: id, userId } })
        else await tx.realEstateProjectMember.upsert({ where: { tenantId_projectId_userId: { tenantId: actor.tenantId, projectId: id, userId } }, create: { tenantId: actor.tenantId, projectId: id, userId }, update: {} })
        await audit(tx, actor, remove ? "realEstate.member.removed" : "realEstate.member.added", id, null, { userId })
        return { version: version + 1 }
      })
    },
  }
}
