import { requireWriteFields, permits } from "@/platform/access/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { Prisma, CrmWorkType } from "@prisma/client"
import { CrmError, canManageCrm, type CrmActor } from "./policy"
import { activityTypeSchema, activityTypeUpdateSchema, activityTypeListSchema } from "./activity-type-validation"
type Tx = Prisma.TransactionClient
type Context = {
  run: PermissionRun
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
type Choice = { type: CrmWorkType; activityTypeId?: string | null }
type Previous = Choice & { activityTypeName?: string | null }

// Batch template validation; never issue a query for each plan step.
export async function resolveActivityTypes(tx: Tx, actor: CrmActor, choices: Choice[]) {
  const ids = [...new Set(choices.flatMap(choice => choice.activityTypeId ? [choice.activityTypeId] : []))]
  const rows = ids.length ? await tx.crmActivityType.findMany({ where: { tenantId: actor.tenantId, id: { in: ids }, archived: false } }) : []
  const byId = new Map(rows.map(row => [row.id, row]))
  return choices.map(choice => {
    if (!choice.activityTypeId) return { activityTypeId: null, activityTypeName: null }
    const row = byId.get(choice.activityTypeId)
    if (!row || row.baseType !== choice.type) throw new CrmError(400, "Choose an active activity type with matching behaviour from this business.")
    return { activityTypeId: row.id, activityTypeName: row.name }
  })
}
export async function resolveActivityType(tx: Tx, actor: CrmActor, choice: Choice, before?: Previous) {
  const id = choice.activityTypeId === undefined ? before?.activityTypeId : choice.activityTypeId
  if (before && (id || null) === (before.activityTypeId || null) && choice.type === before.type) {
    return { activityTypeId: before.activityTypeId || null, activityTypeName: before.activityTypeName || null }
  }
  return (await resolveActivityTypes(tx, actor, [{ ...choice, activityTypeId: id }]))[0]
}
export function createActivityTypeService({ run, audit }: Context) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can configure activity types.") }
  return {
    getActivityType(id: string) {
      return run("activityTypes.read", async (tx, actor) => {
        const row = await tx.crmActivityType.findFirst({ where: { tenantId: actor.tenantId, id } })
        if (!row) throw new CrmError(404, "Activity type not found.")
        return row
      })
    },
    listActivityTypes(input: unknown) {
      const query = activityTypeListSchema.parse(input)
      return run("activityTypes.read", async (tx, actor) => {
        const where = { tenantId: actor.tenantId, ...(query.includeArchived === "true" ? {} : { archived: query.archived === "true" }), name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([
          tx.crmActivityType.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmActivityType.count({ where }),
        ])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), canManage: canManageCrm(actor.role) && permits(actor, "activityTypes.edit") }
      })
    },
    createActivityType(input: unknown) {
      const data = activityTypeSchema.parse(input)
      return run("activityTypes.create", async (tx, actor) => { requireWriteFields(actor, "activityTypes", undefined, data);
        manage(actor)
        const record = await tx.crmActivityType.create({ data: { ...data, nameKey: data.name.toLowerCase(), tenantId: actor.tenantId } })
        await audit(tx, actor, "crm.activityType.created", record.id, undefined, data)
        return record
      })
    },
    updateActivityType(id: string, input: unknown) {
      const { version, ...data } = activityTypeUpdateSchema.parse(input)
      return run("activityTypes.edit", async (tx, actor) => {
        manage(actor)
        const before = await tx.crmActivityType.findFirst({ where: { tenantId: actor.tenantId, id } })
        requireWriteFields(actor, "activityTypes", before ?? undefined, data)
        if (!before) throw new CrmError(404, "Activity type not found.")
        if (before.baseType !== data.baseType) throw new CrmError(400, "Behaviour cannot change after creation. Create a new activity type instead.")
        const changed = await tx.crmActivityType.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...data, nameKey: data.name.toLowerCase(), version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This activity type changed. Refresh before saving.")
        await audit(tx, actor, "crm.activityType.updated", id, { name: before.name, archived: before.archived, defaultInstructions: before.defaultInstructions }, data)
        return tx.crmActivityType.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } })
      })
    },
  }
}
