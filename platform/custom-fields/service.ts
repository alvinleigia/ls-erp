import { requireWriteFields } from "@/platform/access/policy"
import { workspaceRead } from "@/platform/access/catalog"
import type { Requirement } from "@/platform/access/catalog"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { requirePermission } from "@/platform/access/policy"
import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { FieldResource } from "./resources"
import { fieldListSchema, fieldSchema } from "./validation"
import { definitions, editableField, fieldView, managesFields, numberValue, validateFieldValue, visibleField } from "./values"

export function createCustomFieldService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, resources: readonly FieldResource[]) {
  async function run<T>(requirement: Requirement, operation: (tx: Prisma.TransactionClient, actor: BusinessActor, available: FieldResource[]) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await db.$transaction(async tx => {
        const user = await findAccessUser(tx, identity.tenantId, identity.userId)
        if (!user || !hasBusinessAccess(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Business workspace access is not permitted.")
        const modules = await tx.tenantModule.findMany({ where: { tenantId: identity.tenantId, enabled: true, allowed: true }, select: { key: true } })
        if (!modules.some(module => module.key === "crm")) throw new BusinessError(403, "CRM must be enabled.")
        const actor = { ...identity, role: user.role, permissions: assignedPermissions(user) }; requirePermission(actor, requirement)
        return operation(tx, actor, resources.filter(resource => modules.some(module => module.key === resource.module)))
      }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 }) } catch (error) {
        const code = (error as { code?: string }).code
        if (code === "P2034" && attempt < 2) continue
        if (code === "P2034") throw new BusinessError(409, "Configuration changed. Refresh before saving.")
        if (code === "P2002") throw new BusinessError(409, "This field code or option name already exists.")
        throw error
      }
    }
  }
  const scopes = (available: FieldResource[]) => [...new Set(available.flatMap(resource => resource.scopes))]
  return {
    list(input: unknown) {
      const query = fieldListSchema.parse(input)
      return run("customFields.read", async (tx, actor, available) => {
        const resource = query.resource ? available.find(resource => resource.key === query.resource) : undefined
        if (query.resource && !resource) throw new BusinessError(403, "This record type is unavailable.")
        if (query.scope && !scopes(available).includes(query.scope)) throw new BusinessError(403, "This record type is unavailable.")
        const where = { tenantId: actor.tenantId, ...(query.salesTeamId ? { salesTeamId: query.salesTeamId } : {}), scope: { in: query.scope ? [query.scope] : resource ? [...resource.scopes] : scopes(available) }, archived: query.archived === "true", ...(!managesFields(actor) ? { visibility: "ALL" } : {}), ...(query.filterable ? { filterable: query.filterable === "true" } : {}), name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.customFieldDefinition.findMany({ where, orderBy: [{ position: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.customFieldDefinition.count({ where })])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), canManage: managesFields(actor), scopes: scopes(available) }
      })
    },
    form(resourceKey: string, salesTeamId: string | null = null) {
      return run(workspaceRead, async (tx, actor, available) => {
        const resource = available.find(resource => resource.key === resourceKey)
        if (!resource) throw new BusinessError(403, "This record type is unavailable.")
        requirePermission(actor, `${resource.permissionResource}.read`)
        if (salesTeamId && !await tx.crmSalesTeam.findFirst({ where: { tenantId: actor.tenantId, id: salesTeamId, ...(!managesFields(actor) ? { members: { some: { tenantId: actor.tenantId, userId: actor.userId } } } : {}) } })) throw new BusinessError(404, "Sales team not found.")
        const fields = await definitions(tx, actor, resource, false, salesTeamId)
        return fields.filter(field => !field.archived).map(field => ({ ...fieldView(actor, field), value: field.defaultValue }))
      })
    },
    get(id: string) {
      return run("customFields.read", async (tx, actor, available) => {
        const field = await tx.customFieldDefinition.findFirst({ where: { tenantId: actor.tenantId, id, scope: { in: scopes(available) } }, include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] } } })
        if (!field || !visibleField(actor, field)) throw new BusinessError(404, "Custom field not found.")
        return { ...field, editable: editableField(actor, field), canManage: managesFields(actor) }
      })
    },
    save(input: unknown, id?: string) {
      const data = fieldSchema.parse(input)
      return run(id ? "customFields.edit" : "customFields.create", async (tx, actor, available) => {
        if (!managesFields(actor)) throw new BusinessError(403, "Only managers can configure custom fields.")
        if (!scopes(available).includes(data.scope)) throw new BusinessError(403, "This record type is unavailable.")
        const before = id ? await tx.customFieldDefinition.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id } }, include: { options: true } }) : null
        requireWriteFields(actor, "customFields", before ?? undefined, data)
        if (id && !before) throw new BusinessError(404, "Custom field not found.")
        if (before && before.version !== data.version) throw new BusinessError(409, "This field changed. Refresh before saving.")
        if (before && (before.salesTeamId !== data.salesTeamId || before.scope !== data.scope || before.type !== data.type || before.code !== data.code)) throw new BusinessError(409, "Record scope, sales team, field code and type cannot change. Create a new field instead.")
        if (!before) for (const resource of available.filter(resource => resource.scopes.includes(data.scope))) {
          if (await tx.customFieldDefinition.count({ where: { tenantId: actor.tenantId, scope: { in: [...resource.scopes] } } }) >= 50) throw new BusinessError(409, "This record type has reached its limit of 50 custom fields, including archived fields.")
        }
        if (data.salesTeamId) {
          if (data.scope === "PROJECT") throw new BusinessError(400, "Project fields apply to the whole business, not a sales team.")
          const team = await tx.crmSalesTeam.findFirst({ where: { tenantId: actor.tenantId, id: data.salesTeamId } })
          if (!team || (!before && team.archived)) throw new BusinessError(400, "Choose an active sales team.")
        }
        const fieldId = id || randomUUID()
        if (data.type !== "SELECT" && data.options.length) throw new BusinessError(400, "Only single-select fields have options.")
        if (data.type === "SELECT" && !data.archived && !data.options.some(option => !option.archived)) throw new BusinessError(400, "Add at least one active option.")
        if (new Set(data.options.map(option => option.name.toLowerCase())).size !== data.options.length) throw new BusinessError(400, "Option names must be unique.")
        const optionIds = data.options.flatMap(option => option.id ? [option.id] : [])
        if (new Set(optionIds).size !== optionIds.length || optionIds.some(optionId => !before?.options.some(option => option.id === optionId))) throw new BusinessError(400, "Invalid option identity.")
        if (before?.options.some(option => !optionIds.includes(option.id))) throw new BusinessError(409, "Archive existing options instead of removing them.")
        for (const option of data.options) requireWriteFields(actor, "customFields", before?.options.find(old => old.id === option.id), option)
        const options = data.options.map((option, position) => ({ ...option, id: option.id || randomUUID(), position, tenantId: actor.tenantId, fieldId }))
        const minimum = data.minimum ? numberValue(data.minimum) : null, maximum = data.maximum ? numberValue(data.maximum) : null
        if (minimum && maximum && minimum.greaterThan(maximum)) throw new BusinessError(400, "Maximum must be at least minimum.")
        const defaultValue = validateFieldValue({ ...data, minimum, maximum, options }, data.defaultValue)
        if (data.required && !data.archived && (data.visibility !== "ALL" || data.editability !== "ALL") && defaultValue === null) throw new BusinessError(400, "A restricted required field needs a default so staff can create records.")
        const { options: _options, version: _version, ...fields } = data
        void _options; void _version
        const values = { ...fields, minimum, maximum, defaultValue: defaultValue === null ? Prisma.DbNull : defaultValue, requiredSince: data.required ? before?.requiredSince ?? new Date() : null }
        if (before) {
          const result = await tx.customFieldDefinition.updateMany({ where: { tenantId: actor.tenantId, id, version: data.version }, data: { ...values, version: { increment: 1 } } })
          if (!result.count) throw new BusinessError(409, "This field changed. Refresh before saving.")
        } else await tx.customFieldDefinition.create({ data: { ...values, tenantId: actor.tenantId, id: fieldId } })
        for (const option of options) await tx.customFieldOption.upsert({ where: { tenantId_fieldId_id: { tenantId: actor.tenantId, fieldId, id: option.id } }, create: option, update: { name: option.name, archived: option.archived, position: option.position } })
        const after = await tx.customFieldDefinition.findUniqueOrThrow({ where: { tenantId_id: { tenantId: actor.tenantId, id: fieldId } }, include: { options: { orderBy: { position: "asc" } } } })
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: `crm.customField.${before ? "updated" : "created"}`, entityType: "CustomFieldDefinition", entityId: fieldId, ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}), after: JSON.parse(JSON.stringify(after)) })
        return after
      })
    },
  }
}
