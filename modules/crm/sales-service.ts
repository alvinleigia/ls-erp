import { resolveSalesTeam, teamSelect } from "./team-service"
import { splitCustomFields } from "@/platform/custom-fields/validation"
import { readCustomFields, saveCustomFields, customFieldFilter, customFieldExport, copySharedFields } from "@/platform/custom-fields/values"
import { enquiryFields, opportunityFields } from "./custom-fields"
import { resolveLostReason } from "./lost-reason-service"
import { checkExportLimit, CRM_EXPORT_LIMIT } from "./csv"
import type { Prisma, CrmOpportunity, CrmEnquiry } from "@prisma/client"
import { maskReferrals, referralInclude } from "./intake-service"
import { CrmError, canManageCrm, contactScope, accountScope, enquiryScope, type CrmActor } from "./policy"
import { crmListSchema, crmNoteSchema } from "./validation"
import { pipelineSchema, pipelineUpdateSchema, opportunitySchema, opportunityUpdateSchema, opportunityMoveSchema, opportunityListSchema } from "./sales-validation"
import { workScope } from "./work-service"
import { businessDate } from "./work-time"
import type { CrmExtensions } from "./extensions"

type Tx = Prisma.TransactionClient
type Context = {
  run: <T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>) => Promise<T>
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
  checkAssignee: (tx: Tx, actor: CrmActor, id: string) => Promise<void>
}
const include = { salesTeam: { select: teamSelect }, contact: { select: { id: true, name: true } }, account: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, pipeline: true, stage: true, ...referralInclude } as const
const stages = { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] }
const page = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const scope = enquiryScope // Opportunities follow the same salesperson assignment rule.

export function createSalesService<Fields extends object, Metadata extends object>({ run, audit, checkAssignee }: Context, extensions: CrmExtensions<Fields, Metadata>) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can configure sales pipelines.") }
  async function find(tx: Tx, actor: CrmActor, id: string) {
    const record = await tx.crmOpportunity.findFirst({ where: { ...scope(actor), id }, include })
    if (!record) throw new CrmError(404, "Opportunity not found.")
    return { ...(await extensions.decorate(tx, actor, "opportunity", await maskReferrals(tx, actor, [record]))).items[0], customFields: await readCustomFields(tx, actor, opportunityFields, record) }
  }
  async function destination(tx: Tx, actor: CrmActor, pipelineId: string, stageId: string, changing = true) {
    const stage = await tx.crmStage.findFirst({ where: { tenantId: actor.tenantId, pipelineId, id: stageId }, include: { pipeline: true } })
    if (!stage) throw new CrmError(404, "Pipeline stage not found.")
    if (changing && (stage.archived || stage.pipeline.archived)) throw new CrmError(409, "Choose an active pipeline and stage.")
    return stage
  }
  function outcome(stage: { kind: string; probability: number }, lossReason: string, probability?: number) {
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
    listOpportunities(input: unknown, exporting = false) {
      const query = opportunityListSchema.parse(input)
      return run(async (tx, actor) => {
        const extensionFilter = await extensions.filters(tx, actor, query)
        const where: Prisma.CrmOpportunityWhereInput = { AND: [scope(actor), {
          salesTeamId: query.salesTeamId, pipelineId: query.pipelineId, stageId: query.stageId, assignedUserId: query.assignedUserId, sourceId: query.sourceId, lostReasonId: query.lostReasonId,
          ...extensionFilter.opportunity,
          ...await customFieldFilter(tx, actor, opportunityFields, query),
          ...(query.kind ? { stage: { kind: query.kind } } : {}), title: { contains: query.q, mode: "insensitive" },
        }] }
        const total = await tx.crmOpportunity.count({ where })
        if (exporting) checkExportLimit(total)
        const items = await tx.crmOpportunity.findMany({ where, include, orderBy: [{ [query.sort]: query.order }, { id: "asc" }], skip: exporting ? 0 : (query.page - 1) * query.pageSize, take: exporting ? CRM_EXPORT_LIMIT : query.pageSize })
        const timeZone = (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
        const now = new Date()
        const overdue = items.length ? await tx.crmTask.groupBy({ by: ["opportunityId"], where: { AND: [workScope(actor), {
          opportunityId: { in: items.map(item => item.id) }, status: { in: ["OPEN", "IN_PROGRESS"] },
          OR: [{ startsAt: { lt: now } }, { startsAt: null, dueOn: { lt: new Date(`${businessDate(now, timeZone)}T00:00:00Z`) } }],
        }] }, _count: { _all: true } }) : []
        const counts = new Map(overdue.map(item => [item.opportunityId, item._count._all]))
        const decorated = await extensions.decorate(tx, actor, "opportunity", await maskReferrals(tx, actor, items))
        return { ...page(decorated.items.map(item => ({ ...item, overdueActivityCount: counts.get(item.id) || 0 })), total, query.page, query.pageSize), ...decorated.metadata, customFieldExport: exporting ? await customFieldExport(tx, actor, opportunityFields, items.map(item => item.id)) : undefined }
      })
    },
    getOpportunity(id: string) { return run((tx, actor) => find(tx, actor, id)) },
    createOpportunity(input: unknown) {
      const custom = splitCustomFields(input)
      const { core, extension } = extensions.splitWrite(custom.core)
      const { enquiryVersion, ...data } = opportunitySchema.parse(core)
      return run(async (tx, actor) => {
        let sourceEnquiry: CrmEnquiry | null = null
        if (data.enquiryId) {
          const enquiry = await tx.crmEnquiry.findFirst({ where: { ...enquiryScope(actor), id: data.enquiryId } })
          if (!enquiry) throw new CrmError(404, "Enquiry not found.")
          const existing = await tx.crmOpportunity.findFirst({ where: { tenantId: actor.tenantId, enquiryId: enquiry.id } })
          if (existing) return find(tx, actor, existing.id)
          if (enquiryVersion !== undefined && enquiry.version !== enquiryVersion) throw new CrmError(409, "This enquiry changed. Refresh before converting.")
          if (enquiry.contactId !== data.contactId) throw new CrmError(400, "Use the enquiry's contact when converting.")
          if (enquiry.status === "CLOSED") throw new CrmError(409, "Reopen this enquiry before converting it.")
          sourceEnquiry = enquiry
        }
        await checkAssignee(tx, actor, data.assignedUserId)
        const team = await resolveSalesTeam(tx, actor, data.salesTeamId === undefined ? sourceEnquiry?.salesTeamId : data.salesTeamId, data.assignedUserId)
        if (sourceEnquiry && (team?.id ?? null) !== sourceEnquiry.salesTeamId) throw new CrmError(400, "Conversion keeps the enquiry's sales team.")
        if (team?.workflow === "ENQUIRY_FIRST" && (!sourceEnquiry || sourceEnquiry.status !== "QUALIFIED")) throw new CrmError(400, "This team requires a qualified enquiry before creating an opportunity.")
        if (sourceEnquiry) extensions.assertConversionInput(extension)
        const expectedCloseOn = data.expectedCloseOn || sourceEnquiry?.targetCloseOn?.toISOString().slice(0, 10)
        if (!expectedCloseOn) throw new CrmError(400, "Enter an expected close date.")
        const accountId = data.accountId === undefined ? sourceEnquiry?.accountId || "" : data.accountId
        await relations(tx, actor, data.contactId, accountId)
        const stage = await destination(tx, actor, data.pipelineId, data.stageId)
        const result = await tx.crmOpportunity.create({ data: {
          ...data, salesTeamId: team?.id ?? null, ...outcome(stage, data.lossReason, data.probability), ...await resolveLostReason(tx, actor, stage.kind === "LOST", data.lostReasonId), tenantId: actor.tenantId,
          accountId: accountId || null, enquiryId: data.enquiryId || null, expectedCloseOn: new Date(`${expectedCloseOn}T00:00:00Z`),
          customFieldsCreatedAt: sourceEnquiry?.createdAt,
          sourceId: sourceEnquiry?.sourceId, source: sourceEnquiry?.source,
          referralContactId: sourceEnquiry?.referralContactId, referralAccountId: sourceEnquiry?.referralAccountId,
          closedAt: stage.kind === "OPEN" ? null : new Date(),
        }, include })
        if (sourceEnquiry) await extensions.copyOnConversion(tx, actor, sourceEnquiry.id, result.id)
        else await extensions.save(tx, actor, "opportunity", result.id, extension)
        if (sourceEnquiry) await copySharedFields(tx, actor, enquiryFields, opportunityFields, sourceEnquiry.id, result.id)
        await saveCustomFields(tx, actor, opportunityFields, result, custom.patch, true, !!sourceEnquiry)
        await history(tx, actor, result.id, "crm.opportunity.created", `Created in ${stage.pipeline.name} / ${stage.name}.`, undefined, result)
        if (data.enquiryId) {
          await tx.crmActivity.create({ data: { tenantId: actor.tenantId, enquiryId: data.enquiryId, actorUserId: actor.userId, event: "crm.enquiry.converted", message: `Created opportunity: ${result.title}.` } })
          await audit(tx, actor, "crm.enquiry.converted", data.enquiryId, undefined, { opportunityId: result.id })
        }
        return { ...(await extensions.decorate(tx, actor, "opportunity", await maskReferrals(tx, actor, [result]))).items[0], customFields: await readCustomFields(tx, actor, opportunityFields, result) }
      })
    },
    updateOpportunity(id: string, input: unknown) {
      const custom = splitCustomFields(input)
      const { core, extension } = extensions.splitWrite(custom.core)
      const { version, ...data } = opportunityUpdateSchema.parse(core)
      return run(async (tx, actor) => {
        const before = await find(tx, actor, id)
        if (before.enquiryId && before.contactId !== data.contactId) throw new CrmError(409, "A converted opportunity keeps the enquiry's contact.")
        if (before.contactId !== data.contactId && await tx.crmTask.count({ where: { tenantId: actor.tenantId, opportunityId: id } })) throw new CrmError(409, "This opportunity has activities. Keep its contact to preserve interaction history.")
        await checkAssignee(tx, actor, data.assignedUserId)
        const team = await resolveSalesTeam(tx, actor, data.salesTeamId, data.assignedUserId, before)
        await relations(tx, actor, data.contactId, data.accountId, before)
        const changedStage = data.stageId !== before.stageId
        const stage = await destination(tx, actor, data.pipelineId, data.stageId, changedStage)
        const updated = await tx.crmOpportunity.updateMany({ where: { ...scope(actor), id, version }, data: {
          ...data, salesTeamId: team?.id ?? null, ...outcome(stage, data.lossReason, data.probability ?? (changedStage ? undefined : before.probability)),
          ...await resolveLostReason(tx, actor, stage.kind === "LOST", data.lostReasonId, before.stage.kind === "LOST" ? before : undefined), accountId: data.accountId || null,
          expectedCloseOn: new Date(`${data.expectedCloseOn}T00:00:00Z`), version: { increment: 1 },
          closedAt: stage.kind === "OPEN" ? null : before.closedAt ?? new Date(),
        } })
        if (!updated.count) throw new CrmError(409, "This opportunity changed. Refresh before saving.")
        await extensions.save(tx, actor, "opportunity", id, extension)
        await saveCustomFields(tx, actor, opportunityFields, { ...before, salesTeamId: team?.id ?? null }, custom.patch)
        const after = await tx.crmOpportunity.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, include })
        await history(tx, actor, id, changedStage ? "crm.opportunity.stage.changed" : "crm.opportunity.updated",
          changedStage ? `${before.pipeline.name} / ${before.stage.name} → ${stage.pipeline.name} / ${stage.name}.${after.lostReasonName ? ` Lost reason: ${after.lostReasonName}.` : ""}${after.lossReason ? ` Closing note: ${after.lossReason}` : ""}` : "Opportunity details updated.", before, after)
        return { ...(await extensions.decorate(tx, actor, "opportunity", await maskReferrals(tx, actor, [after]))).items[0], customFields: await readCustomFields(tx, actor, opportunityFields, after) }
      })
    },
    moveOpportunity(id: string, input: unknown) {
      const data = opportunityMoveSchema.parse(input)
      return run(async (tx, actor) => {
        const before = await find(tx, actor, id)
        if (before.version !== data.version) throw new CrmError(409, "This opportunity changed. Refresh before moving it.")
        const stage = await destination(tx, actor, data.pipelineId, data.stageId)
        if (before.stageId === stage.id) return before
        const fields = { ...outcome(stage, data.lossReason), ...await resolveLostReason(tx, actor, stage.kind === "LOST", data.lostReasonId, before.stage.kind === "LOST" ? before : undefined) }
        const updated = await tx.crmOpportunity.updateMany({ where: { ...scope(actor), id, version: data.version }, data: {
          ...fields, stageId: stage.id, pipelineId: data.pipelineId, version: { increment: 1 }, closedAt: stage.kind === "OPEN" ? null : before.closedAt ?? new Date(),
        } })
        if (!updated.count) throw new CrmError(409, "This opportunity changed. Refresh before moving it.")
        const after = await find(tx, actor, id)
        await history(tx, actor, id, "crm.opportunity.stage.changed", `${before.pipeline.name} / ${before.stage.name} → ${stage.pipeline.name} / ${stage.name}.${fields.lostReasonName ? ` Lost reason: ${fields.lostReasonName}.` : ""}${fields.lossReason ? ` Closing note: ${fields.lossReason}` : ""}`, before, after)
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
