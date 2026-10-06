import { requireWriteFields, permits } from "@/platform/access/policy"
import type { Requirement } from "@/platform/access/catalog"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { requirePermission } from "@/platform/access/policy"
import { splitCustomFields } from "@/platform/custom-fields/validation"
import { readCustomFields, saveCustomFields, customFieldFilter, customFieldExport } from "@/platform/custom-fields/values"
import { projectFields } from "./custom-fields"
import { CRM_EXPORT_LIMIT, checkExportLimit } from "@/modules/crm/csv"
import { Prisma, type PrismaClient } from "@prisma/client"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { accountScope } from "@/modules/crm/policy"
import { memberSchema, projectListSchema, projectSchema, projectUpdateSchema } from "./validation"
import { createPropertyChoiceService, propertyChoiceDefaults, resolvePropertyChoice, validatePropertyCategories } from "./choice-service"

type Tx = Prisma.TransactionClient
const manage = (actor: BusinessActor) => actor.role === "ADMIN" || actor.role === "MANAGER"
const requireManager = (actor: BusinessActor) => { if (!manage(actor)) throw new BusinessError(403, "Only managers can change projects and staff access.") }
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
export const projectScope = (actor: BusinessActor): Prisma.RealEstateProjectWhereInput => ({ tenantId: actor.tenantId, ...(!manage(actor) ? {
  archived: false, OR: [
    { parentId: null, members: { some: { tenantId: actor.tenantId, userId: actor.userId } } },
    { parent: { archived: false, members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } },
  ],
} : {}) })
const pageResult = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })

// Module operations own permissions, tenant scope and audited writes. Callers
// establish the tenant database context, as for CRM services.
export function createRealEstateService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) {
  async function run<T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.$transaction(async tx => {
          const user = await findAccessUser(tx, identity.tenantId, identity.userId)
          if (!user || !hasBusinessAccess(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Business workspace access is not permitted.")
          const enabled = await tx.tenantModule.count({ where: { tenantId: identity.tenantId, key: { in: ["crm", "realEstate"] }, enabled: true, allowed: true } })
          if (enabled !== 2) throw new BusinessError(403, "Real Estate and CRM must be enabled for this business.")
          const actor = { ...identity, role: user.role, permissions: assignedPermissions(user), crmRecordScope: user.crmRecordScope, managedTeamIds: user.managedTeamIds }; requirePermission(actor, requirement)
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
    const record = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor), { id }] } })
    if (!record) throw new BusinessError(404, "Project not found.")
    return record
  }
  async function audit(tx: Tx, actor: BusinessActor, event: string, entityId: string, before: unknown, after: unknown) {
    await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event, entityType: "RealEstateProject", entityId, before: snapshot(before), after: snapshot(after) })
  }
  async function values(tx: Tx, actor: BusinessActor, data: ReturnType<typeof projectSchema.parse>, before?: Awaited<ReturnType<typeof find>>) {
    const defaults = !before && (!data.lifecycle || data.categories === undefined) ? await propertyChoiceDefaults(tx, actor.tenantId) : null
    const lifecycle = data.lifecycle || before?.lifecycle || defaults?.["project-statuses"]?.id
    const categories = data.categories ?? before?.categories ?? (defaults?.["property-categories"] ? [defaults["property-categories"].id] : [])
    if (!lifecycle) throw new BusinessError(400, "Choose a project status or configure a default.")
    await resolvePropertyChoice(tx, actor.tenantId, "project-statuses", lifecycle, before?.lifecycle)
    await validatePropertyCategories(tx, actor.tenantId, categories, before?.categories)
    if (before && (data.parentId || null) !== before.parentId) throw new BusinessError(400, "A project's parent cannot be changed. Create a subproject under the correct project.")
    if (data.parentId) {
      const parent = await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: data.parentId, parentId: null } })
      if (!parent) throw new BusinessError(400, "Choose a top-level project in this business.")
      if (parent.archived && (!before || !data.archived)) throw new BusinessError(409, "Restore the parent project before creating or restoring a subproject.")
    }
    if (data.developerAccountId && data.developerAccountId !== before?.developerAccountId && !await tx.crmAccount.findFirst({ where: { tenantId: actor.tenantId, id: data.developerAccountId, archived: false } })) throw new BusinessError(400, "Choose an active developer business account.")
    const priceMin = data.priceMin ? new Prisma.Decimal(data.priceMin) : null
    const priceMax = data.priceMax ? new Prisma.Decimal(data.priceMax) : null
    if ((priceMin || priceMax) && !data.currency) throw new BusinessError(400, "Choose a currency for the indicative price range.")
    if (priceMin && priceMax && priceMin.greaterThan(priceMax)) throw new BusinessError(400, "Maximum price must be at least the minimum price.")
    return { ...data, lifecycle, categories: [...new Set(categories)], parentId: data.parentId || null, developerAccountId: data.developerAccountId || null, priceMin, priceMax, currency: data.currency || null }
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
        return { ...pageResult(items, total, query.page, query.pageSize), canManage: manage(actor) && permits(actor, "projects.edit"), customFieldExport: exporting ? await customFieldExport(tx, actor, projectFields, items.map(item => item.id)) : undefined }
      })
    },
    getProject(id: string) {
      return run("projects.read", async (tx, actor) => {
        const record = await find(tx, actor, id)
        const developerAccount = record.developerAccountId ? await tx.crmAccount.findFirst({ where: { AND: [accountScope(actor), { id: record.developerAccountId }] }, select: { id: true, name: true } }) : null
        const parent = record.parentId ? await tx.realEstateProject.findFirst({ where: { tenantId: actor.tenantId, id: record.parentId }, select: { id: true, name: true, archived: true } }) : null
        return { ...record, customFields: await readCustomFields(tx, actor, projectFields, record), developerAccountId: developerAccount?.id || null, developerAccount, developerRestricted: !!record.developerAccountId && !developerAccount, parent, canManage: manage(actor) && permits(actor, "projects.edit") }
      })
    },
    createProject(input: unknown) {
      const custom = splitCustomFields(input)
      const data = projectSchema.parse(custom.core)
      return run("projects.create", async (tx, actor) => { requireWriteFields(actor, "projects", undefined, data);
        requireManager(actor)
        const record = await tx.realEstateProject.create({ data: { ...await values(tx, actor, data), tenantId: actor.tenantId } })
        await saveCustomFields(tx, actor, projectFields, record, custom.patch, true)
        await audit(tx, actor, "realEstate.project.created", record.id, null, record)
        return record
      })
    },
    updateProject(id: string, input: unknown) {
      const custom = splitCustomFields(input)
      const { version, ...data } = projectUpdateSchema.parse(custom.core)
      return run("projects.edit", async (tx, actor) => {
        requireManager(actor)
        const before = await find(tx, actor, id)
        requireWriteFields(actor, "projects", before ?? undefined, data)
        const next = await values(tx, actor, data, before)
        const changed = await tx.realEstateProject.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...next, version: { increment: 1 } } })
        if (!changed.count) throw new BusinessError(409, "This project changed. Refresh before saving.")
        const record = await find(tx, actor, id)
        await saveCustomFields(tx, actor, projectFields, record, custom.patch)
        await audit(tx, actor, "realEstate.project.updated", id, before, record)
        return record
      })
    },
    listMembers(id: string, input: unknown) {
      const query = projectListSchema.parse(input)
      return run("projects.read", async (tx, actor) => {
        requireManager(actor)
        const project = await find(tx, actor, id)
        const where = { tenantId: actor.tenantId, projectId: project.parentId || project.id }
        const [rows, total] = await Promise.all([tx.realEstateProjectMember.findMany({ where, include: { user: { select: { id: true, name: true, status: true, role: true } } }, orderBy: { userId: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.realEstateProjectMember.count({ where })])
        return { ...pageResult(rows.map(row => row.user), total, query.page, query.pageSize), version: project.version }
      })
    },
    changeMember(id: string, input: unknown) {
      const { userId, version, remove } = memberSchema.parse(input)
      return run("projects.assign", async (tx, actor) => {
        requireManager(actor)
        const project = await find(tx, actor, id)
        if (project.parentId || project.archived) throw new BusinessError(409, "Manage staff access on an active top-level project.")
        if (!remove && !await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: userId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } } })) throw new BusinessError(400, "Choose an active staff member in this business.")
        const changed = await tx.realEstateProject.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { version: { increment: 1 } } })
        if (!changed.count) throw new BusinessError(409, "This project changed. Refresh before saving.")
        if (remove) await tx.realEstateProjectMember.deleteMany({ where: { tenantId: actor.tenantId, projectId: id, userId } })
        else await tx.realEstateProjectMember.upsert({ where: { tenantId_projectId_userId: { tenantId: actor.tenantId, projectId: id, userId } }, create: { tenantId: actor.tenantId, projectId: id, userId }, update: {} })
        await audit(tx, actor, remove ? "realEstate.member.removed" : "realEstate.member.added", id, null, { userId })
        return { version: version + 1 }
      })
    },
  }
}
