import { requireWriteFields, permits } from "@/platform/access/policy"
import type { PermissionRun } from "@/platform/access/server"
import type { Prisma } from "@prisma/client"
import { CrmError, canManageCrm, type CrmActor } from "./policy"
import { lostReasonSchema, lostReasonUpdateSchema, lostReasonListSchema } from "./lost-reason-validation"
type Tx = Prisma.TransactionClient
type Context = {
  run: PermissionRun
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
const reasonKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()

// Preserve historical labels and unclassified legacy closures. New closures and
// changed choices must select an active reason in this business.
export async function resolveLostReason(tx: Tx, actor: CrmActor, lost: boolean, requested: string | undefined,
  before?: { lostReasonId: string | null; lostReasonName: string | null }) {
  if (!lost) return { lostReasonId: null, lostReasonName: null }
  const id = requested === undefined ? before?.lostReasonId : requested || null
  if (before && id === before.lostReasonId) return { lostReasonId: before.lostReasonId, lostReasonName: before.lostReasonName }
  if (!id) throw new CrmError(400, "Choose a lost reason before marking this record Lost.")
  const reason = await tx.crmLostReason.findFirst({ where: { tenantId: actor.tenantId, id, archived: false } })
  if (!reason) throw new CrmError(400, "Choose an active lost reason from this business.")
  return { lostReasonId: reason.id, lostReasonName: reason.name }
}
export function createLostReasonService({ run, audit }: Context) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can configure lost reasons.") }
  return {
    listLostReasons(input: unknown) {
      const query = lostReasonListSchema.parse(input)
      return run("lostReasons.read", async (tx, actor) => {
        const where = { tenantId: actor.tenantId, ...(query.includeArchived === "true" ? {} : { archived: query.archived === "true" }), name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([
          tx.crmLostReason.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmLostReason.count({ where }),
        ])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), canManage: canManageCrm(actor.role) && permits(actor, "lostReasons.edit") }
      })
    },
    createLostReason(input: unknown) {
      const data = lostReasonSchema.parse(input)
      return run("lostReasons.create", async (tx, actor) => { requireWriteFields(actor, "lostReasons", undefined, data);
        manage(actor)
        const record = await tx.crmLostReason.create({ data: { ...data, nameKey: reasonKey(data.name), tenantId: actor.tenantId } })
        await audit(tx, actor, "crm.lostReason.created", record.id, undefined, data)
        return record
      })
    },
    updateLostReason(id: string, input: unknown) {
      const { version, ...data } = lostReasonUpdateSchema.parse(input)
      return run("lostReasons.edit", async (tx, actor) => {
        manage(actor)
        const before = await tx.crmLostReason.findFirst({ where: { tenantId: actor.tenantId, id } })
        requireWriteFields(actor, "lostReasons", before ?? undefined, data)
        if (!before) throw new CrmError(404, "Lost reason not found.")
        const changed = await tx.crmLostReason.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...data, nameKey: reasonKey(data.name), version: { increment: 1 } } })
        if (!changed.count) throw new CrmError(409, "This reason changed. Refresh before saving.")
        await audit(tx, actor, "crm.lostReason.updated", id, { name: before.name, archived: before.archived }, data)
        return tx.crmLostReason.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } })
      })
    },
  }
}
