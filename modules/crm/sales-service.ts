import type { Prisma, CrmOpportunity } from "@prisma/client"
import { CrmError, canManageCrm, contactScope, accountScope, enquiryScope, type CrmActor } from "./policy"
import { crmListSchema, crmNoteSchema } from "./validation"
import { pipelineSchema, pipelineUpdateSchema, opportunitySchema, opportunityUpdateSchema, opportunityMoveSchema, opportunityListSchema } from "./sales-validation"

type Tx = Prisma.TransactionClient
type Context = {
  run: <T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>) => Promise<T>
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
  checkAssignee: (tx: Tx, actor: CrmActor, id: string) => Promise<void>
}
const include = { contact: { select: { id: true, name: true } }, account: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, pipeline: true, stage: true } as const
const stages = { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] }
const page = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const scope = enquiryScope // Opportunities follow the same salesperson assignment rule.

export function createSalesService({ run, audit, checkAssignee }: Context) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can configure sales pipelines.") }
  async function find(tx: Tx, actor: CrmActor, id: string) {
    const record = await tx.crmOpportunity.findFirst({ where: { ...scope(actor), id }, include })
    if (!record) throw new CrmError(404, "Opportunity not found.")
    return record
  }
  async function destination(tx: Tx, actor: CrmActor, pipelineId: string, stageId: string, changing = true) {
    const stage = await tx.crmStage.findFirst({ where: { tenantId: actor.tenantId, pipelineId, id: stageId }, include: { pipeline: true } })
    if (!stage) throw new CrmError(404, "Pipeline stage not found.")
    if (changing && (stage.archived || stage.pipeline.archived)) throw new CrmError(409, "Choose an active pipeline and stage.")
    return stage
  }
  function outcome(stage: { kind: string; probability: number }, lossReason: string, probability?: number) {
    if (stage.kind === "LOST" && !lossReason) throw new CrmError(400, "Record a loss reason before closing this opportunity.")
    if (stage.kind === "OPEN" && probability === 100) throw new CrmError(400, "Use a won stage for 100% probability.")
    return { probability: stage.kind === "WON" ? 100 : stage.kind === "LOST" ? 0 : probability ?? stage.probability,
      lossReason: stage.kind === "LOST" ? lossReason : null }
  }
  async function relations(tx: Tx, actor: CrmActor, contactId: string, accountId: string, before?: CrmOpportunity) {
    const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: contactId } })
    if (!contact) throw new CrmError(404, "Contact not found.")
    if (contact.archived && before?.contactId !== contactId) throw new CrmError(409, "Restore the contact before creating an opportunity.")
    if (accountId) {
      const account = await tx.crmAccount.findFirst({ where: { ...accountScope(actor), id: accountId } })
      if (!account) throw new CrmError(404, "Business account not found.")
      if (account.archived && before?.accountId !== accountId) throw new CrmError(409, "Choose an active business account.")
    }
  }
  async function history(tx: Tx, actor: CrmActor, id: string, event: string, message: string, before?: unknown, after?: unknown) {
    await tx.crmOpportunityActivity.create({ data: { tenantId: actor.tenantId, opportunityId: id, actorUserId: actor.userId, event, message } })
    await audit(tx, actor, event, id, before ? snapshot(before) : undefined, after ? snapshot(after) : undefined)
  }
  return {
    listPipelines(input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        const where = { tenantId: actor.tenantId, archived: query.archived === "true", name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([
          tx.crmPipeline.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmPipeline.count({ where }),
        ])
        return { ...page(items, total, query.page, query.pageSize), canManage: canManageCrm(actor.role) }
      })
    },
    getPipeline(id: string) {
      return run(async (tx, actor) => {
        const record = await tx.crmPipeline.findFirst({ where: { tenantId: actor.tenantId, id }, include: { stages } })
        if (!record) throw new CrmError(404, "Pipeline not found.")
        return { ...record, canManage: canManageCrm(actor.role) }
      })
    },
    createPipeline(input: unknown) {
      const data = pipelineSchema.parse(input)
      return run(async (tx, actor) => {
        manage(actor)
        if (data.stages.some(stage => stage.id)) throw new CrmError(400, "New stages must not supply IDs.")
        const pipeline = await tx.crmPipeline.create({ data: { tenantId: actor.tenantId, name: data.name, archived: data.archived } })
        for (const [position, stage] of data.stages.entries()) await tx.crmStage.create({ data: { ...stage, position, tenantId: actor.tenantId, pipelineId: pipeline.id } })
        await audit(tx, actor, "crm.pipeline.created", pipeline.id, undefined, data)
        return tx.crmPipeline.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: pipeline.id }, include: { stages } })
      })
    },
    updatePipeline(id: string, input: unknown) {
      const data = pipelineUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        manage(actor)
        const before = await tx.crmPipeline.findFirst({ where: { tenantId: actor.tenantId, id }, include: { stages } })
        if (!before) throw new CrmError(404, "Pipeline not found.")
        if (before.stages.some(stage => !data.stages.some(next => next.id === stage.id))) throw new CrmError(409, "Archive existing stages instead of removing them, so history is preserved.")
        for (const stage of data.stages) {
          if (!stage.id) continue
          const old = before.stages.find(item => item.id === stage.id)
          if (!old) throw new CrmError(400, "A stage belongs to another pipeline.")
          if (old.kind !== stage.kind && await tx.crmOpportunity.count({ where: { tenantId: actor.tenantId, stageId: stage.id } })) throw new CrmError(409, "A stage in use cannot change outcome type. Create a new stage and move its opportunities.")
        }
        const updated = await tx.crmPipeline.updateMany({ where: { tenantId: actor.tenantId, id, version: data.version }, data: { name: data.name, archived: data.archived, version: { increment: 1 } } })
        if (!updated.count) throw new CrmError(409, "This pipeline changed. Refresh before saving.")
        for (const [position, stage] of data.stages.entries()) {
          const { id: stageId, ...fields } = stage
          if (stageId) await tx.crmStage.updateMany({ where: { tenantId: actor.tenantId, pipelineId: id, id: stageId }, data: { ...fields, position } })
          else await tx.crmStage.create({ data: { ...fields, position, tenantId: actor.tenantId, pipelineId: id } })
        }
        await audit(tx, actor, "crm.pipeline.updated", id, snapshot(before), data)
        return tx.crmPipeline.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, include: { stages } })
      })
    },
    listOpportunities(input: unknown) {
      const query = opportunityListSchema.parse(input)
      return run(async (tx, actor) => {
        const where: Prisma.CrmOpportunityWhereInput = { AND: [scope(actor), {
          pipelineId: query.pipelineId, stageId: query.stageId, assignedUserId: query.assignedUserId,
          ...(query.kind ? { stage: { kind: query.kind } } : {}), title: { contains: query.q, mode: "insensitive" },
        }] }
        const [items, total] = await Promise.all([
          tx.crmOpportunity.findMany({ where, include, orderBy: [{ [query.sort]: query.order }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmOpportunity.count({ where }),
        ])
        return page(items, total, query.page, query.pageSize)
      })
    },
    getOpportunity(id: string) { return run((tx, actor) => find(tx, actor, id)) },
    createOpportunity(input: unknown) {
      const data = opportunitySchema.parse(input)
      return run(async (tx, actor) => {
        if (data.enquiryId) {
          const enquiry = await tx.crmEnquiry.findFirst({ where: { ...enquiryScope(actor), id: data.enquiryId } })
          if (!enquiry) throw new CrmError(404, "Enquiry not found.")
          const existing = await tx.crmOpportunity.findFirst({ where: { tenantId: actor.tenantId, enquiryId: enquiry.id } })
          if (existing) return find(tx, actor, existing.id)
          if (enquiry.contactId !== data.contactId) throw new CrmError(400, "Use the enquiry's contact when converting.")
          if (enquiry.status === "CLOSED") throw new CrmError(409, "Reopen this enquiry before converting it.")
        }
        await checkAssignee(tx, actor, data.assignedUserId)
        await relations(tx, actor, data.contactId, data.accountId)
        const stage = await destination(tx, actor, data.pipelineId, data.stageId)
        const result = await tx.crmOpportunity.create({ data: {
          ...data, ...outcome(stage, data.lossReason, data.probability), tenantId: actor.tenantId,
          accountId: data.accountId || null, enquiryId: data.enquiryId || null, expectedCloseOn: new Date(`${data.expectedCloseOn}T00:00:00Z`),
          closedAt: stage.kind === "OPEN" ? null : new Date(),
        }, include })
        await history(tx, actor, result.id, "crm.opportunity.created", `Created in ${stage.pipeline.name} / ${stage.name}.`, undefined, result)
        if (data.enquiryId) {
          await tx.crmActivity.create({ data: { tenantId: actor.tenantId, enquiryId: data.enquiryId, actorUserId: actor.userId, event: "crm.enquiry.converted", message: `Created opportunity: ${result.title}.` } })
          await audit(tx, actor, "crm.enquiry.converted", data.enquiryId, undefined, { opportunityId: result.id })
        }
        return result
      })
    },
    updateOpportunity(id: string, input: unknown) {
      const { version, ...data } = opportunityUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        const before = await find(tx, actor, id)
        if (before.enquiryId && before.contactId !== data.contactId) throw new CrmError(409, "A converted opportunity keeps the enquiry's contact.")
        await checkAssignee(tx, actor, data.assignedUserId)
        await relations(tx, actor, data.contactId, data.accountId, before)
        const changedStage = data.stageId !== before.stageId
        const stage = await destination(tx, actor, data.pipelineId, data.stageId, changedStage)
        const updated = await tx.crmOpportunity.updateMany({ where: { ...scope(actor), id, version }, data: {
          ...data, ...outcome(stage, data.lossReason, data.probability ?? (changedStage ? undefined : before.probability)), accountId: data.accountId || null,
          expectedCloseOn: new Date(`${data.expectedCloseOn}T00:00:00Z`), version: { increment: 1 },
          closedAt: stage.kind === "OPEN" ? null : before.closedAt ?? new Date(),
        } })
        if (!updated.count) throw new CrmError(409, "This opportunity changed. Refresh before saving.")
        const after = await tx.crmOpportunity.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, include })
        await history(tx, actor, id, changedStage ? "crm.opportunity.stage.changed" : "crm.opportunity.updated",
          changedStage ? `${before.pipeline.name} / ${before.stage.name} → ${stage.pipeline.name} / ${stage.name}.${after.lossReason ? ` Loss reason: ${after.lossReason}` : ""}` : "Opportunity details updated.", before, after)
        return after
      })
    },
    moveOpportunity(id: string, input: unknown) {
      const data = opportunityMoveSchema.parse(input)
      return run(async (tx, actor) => {
        const before = await find(tx, actor, id)
        if (before.version !== data.version) throw new CrmError(409, "This opportunity changed. Refresh before moving it.")
        const stage = await destination(tx, actor, data.pipelineId, data.stageId)
        if (before.stageId === stage.id) return before
        const fields = outcome(stage, data.lossReason)
        const updated = await tx.crmOpportunity.updateMany({ where: { ...scope(actor), id, version: data.version }, data: {
          ...fields, stageId: stage.id, pipelineId: data.pipelineId, version: { increment: 1 }, closedAt: stage.kind === "OPEN" ? null : before.closedAt ?? new Date(),
        } })
        if (!updated.count) throw new CrmError(409, "This opportunity changed. Refresh before moving it.")
        const after = await find(tx, actor, id)
        await history(tx, actor, id, "crm.opportunity.stage.changed", `${before.pipeline.name} / ${before.stage.name} → ${stage.pipeline.name} / ${stage.name}.${fields.lossReason ? ` Loss reason: ${fields.lossReason}` : ""}`, before, after)
        return after
      })
    },
    listOpportunityActivity(id: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        await find(tx, actor, id)
        const where = { tenantId: actor.tenantId, opportunityId: id }
        const [items, total] = await Promise.all([
          tx.crmOpportunityActivity.findMany({ where, include: { actor: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmOpportunityActivity.count({ where }),
        ])
        return page(items, total, query.page, query.pageSize)
      })
    },
    addOpportunityNote(id: string, input: unknown) {
      const data = crmNoteSchema.parse(input)
      return run(async (tx, actor) => {
        await find(tx, actor, id)
        await history(tx, actor, id, "crm.opportunity.note.added", data.message, undefined, data)
        return { success: true }
      })
    },
  }
}
