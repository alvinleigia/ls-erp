import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { choiceKindSchema, choiceKinds, choiceSchema, choiceUpdateSchema, choiceListSchema, type ChoiceKind, type PropertyChoice } from "./choices"

type Tx = Prisma.TransactionClient
type Run = <T>(operation: (tx: Tx, actor: BusinessActor) => Promise<T>) => Promise<T>
// Identifiers come exclusively from this allowlist, never request interpolation.
const tables = {
  "project-statuses": Prisma.raw('"RealEstateProjectStatus"'),
  "property-categories": Prisma.raw('"RealEstatePropertyCategory"'),
  "buying-timeframes": Prisma.raw('"RealEstateBuyingTimeframe"'),
} as const
const manage = (actor: BusinessActor) => actor.role === "ADMIN" || actor.role === "MANAGER"
export async function resolvePropertyChoice(tx: Tx, tenantId: string, kind: ChoiceKind, id: string, retained?: string | null) {
  if (!id) return
  const [choice] = await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`SELECT * FROM ${tables[kind]} WHERE "tenantId"=${tenantId} AND id=${id}`)
  if (!choice || (choice.archived && id !== retained)) throw new BusinessError(400, "Choose an active option from this business.")
  return choice
}
export async function validatePropertyCategories(tx: Tx, tenantId: string, ids: string[], retained: string[] = []) {
  if (!ids.length) return
  const choices = await tx.realEstatePropertyCategory.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, archived: true } })
  const byId = new Map(choices.map(choice => [choice.id, choice]))
  if (ids.some(id => !byId.has(id) || (byId.get(id)!.archived && !retained.includes(id)))) throw new BusinessError(400, "Choose active property categories from this business.")
}
export async function propertyChoiceDefaults(tx: Tx, tenantId: string) {
  const entries = await Promise.all(choiceKinds.map(async kind => {
    const [row] = await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`SELECT * FROM ${tables[kind]} WHERE "tenantId"=${tenantId} AND "isDefault"=true AND archived=false LIMIT 1`)
    return [kind, row || null] as const
  }))
  return Object.fromEntries(entries) as Record<ChoiceKind, PropertyChoice | null>
}
export function createPropertyChoiceService(run: Run) {
  async function find(tx: Tx, actor: BusinessActor, kind: ChoiceKind, id: string) {
    const [row] = await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`SELECT * FROM ${tables[kind]} WHERE "tenantId"=${actor.tenantId} AND id=${id}`)
    if (!row) throw new BusinessError(404, "Choice not found.")
    return row
  }
  return {
    choiceDefaults: () => run((tx, actor) => propertyChoiceDefaults(tx, actor.tenantId)),
    listChoices(kindInput: unknown, input: unknown) {
      const kind = choiceKindSchema.parse(kindInput), query = choiceListSchema.parse(input)
      return run(async (tx, actor) => {
        const where = Prisma.sql`"tenantId"=${actor.tenantId} AND (${query.includeArchived === "true"} OR archived=${query.archived === "true"}) AND strpos(lower(name),lower(${query.q})) > 0`
        const [items, [count]] = await Promise.all([
          tx.$queryRaw<PropertyChoice[]>(Prisma.sql`SELECT * FROM ${tables[kind]} WHERE ${where} ORDER BY position,name,id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
          tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM ${tables[kind]} WHERE ${where}`),
        ])
        return { items, total: count.total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(count.total / query.pageSize)), canManage: manage(actor) }
      })
    },
    getChoice(kindInput: unknown, id: string) {
      const kind = choiceKindSchema.parse(kindInput)
      return run(async (tx, actor) => ({ ...await find(tx, actor, kind, id), canManage: manage(actor) }))
    },
    saveChoice(kindInput: unknown, input: unknown, id?: string) {
      const kind = choiceKindSchema.parse(kindInput)
      const data = id ? choiceUpdateSchema.parse(input) : { ...choiceSchema.parse(input), version: undefined }
      return run(async (tx, actor) => {
        if (!manage(actor)) throw new BusinessError(403, "Only managers can configure property choices.")
        const before = id ? await find(tx, actor, kind, id) : null
        if (before && before.version !== data.version) throw new BusinessError(409, "This choice changed. Refresh before saving.")
        const nameKey = data.name.toLowerCase()
        const duplicate = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ${tables[kind]} WHERE "tenantId"=${actor.tenantId} AND "nameKey"=${nameKey} AND id<>${id || ""}`)
        if (duplicate.length) throw new BusinessError(409, "This name already exists. Edit or restore that choice.")
        if (data.isDefault) {
          const prior = await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`SELECT * FROM ${tables[kind]} WHERE "tenantId"=${actor.tenantId} AND "isDefault"=true AND id<>${id || ""}`)
          const changed = await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`UPDATE ${tables[kind]} SET "isDefault"=false, version=version+1, "updatedAt"=CURRENT_TIMESTAMP WHERE "tenantId"=${actor.tenantId} AND "isDefault"=true AND id<>${id || ""} RETURNING *`)
          for (const row of changed) await audit(row.id, prior.find(old => old.id === row.id), row)
        }
        const nextId = id || randomUUID()
        const rows = id
          ? await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`UPDATE ${tables[kind]} SET name=${data.name}, "nameKey"=${nameKey}, position=${data.position}, "isDefault"=${data.isDefault}, archived=${data.archived}, version=version+1, "updatedAt"=CURRENT_TIMESTAMP WHERE "tenantId"=${actor.tenantId} AND id=${id} AND version=${before!.version} RETURNING *`)
          : await tx.$queryRaw<PropertyChoice[]>(Prisma.sql`INSERT INTO ${tables[kind]} ("tenantId",id,name,"nameKey",position,"isDefault",archived,"updatedAt") VALUES (${actor.tenantId},${nextId},${data.name},${nameKey},${data.position},${data.isDefault},${data.archived},CURRENT_TIMESTAMP) RETURNING *`)
        if (!rows.length) throw new BusinessError(409, "This choice changed. Refresh before saving.")
        await audit(nextId, before, rows[0])
        return rows[0]
        async function audit(entityId: string, oldValue: unknown, newValue: unknown) {
          await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
            event: `realEstate.${kind}.${oldValue ? "updated" : "created"}`, entityType: `RealEstateChoice:${kind}`, entityId,
            before: JSON.parse(JSON.stringify(oldValue)), after: JSON.parse(JSON.stringify(newValue)),
          })
        }
      })
    },
  }
}
