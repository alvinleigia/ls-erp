import { requirePermission, requireWriteFields, permits } from "@/platform/access/policy"
import type { PermissionRun } from "@/platform/access/server"
import { resolveActivityType } from "./activity-type-service"
import type { CrmExtensions } from "./extensions"
import type { Prisma, CrmTask } from "@prisma/client"
import { CrmError, canManageCrm, contactScope, enquiryScope, type CrmActor } from "./policy"
import { crmListSchema, crmNoteSchema } from "./validation"
import { workCreateSchema, workUpdateSchema, workCompleteSchema, workCancelSchema, workReminderSchema, workListSchema, workOutcomes, type WorkScheduleInput, type WorkCreateInput } from "./work-validation"
import { businessDate, startOfBusinessDate } from "./work-time"
import { createPlanService } from "./plan-service"
import { prepareRuleFollowUp } from "./follow-up-service"
import { workRulePreviewSchema } from "./work-validation"

type Tx = Prisma.TransactionClient
type Context = {
  run: PermissionRun
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
  checkAssignee: (tx: Tx, actor: CrmActor, id: string) => Promise<void>
}
const openStatuses = ["OPEN", "IN_PROGRESS"] as const
const page = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const include = { contact: { select: { id: true, name: true, email: true, phone: true } }, assignee: { select: { id: true, name: true } }, enquiry: { select: { id: true, title: true, assignedUserId: true } }, opportunity: { select: { id: true, title: true, assignedUserId: true } }, planLaunch: { select: { planName: true, planVersion: true } } } as const
type Loaded = Prisma.CrmTaskGetPayload<{ include: typeof include }>
export function workScope(actor: CrmActor): Prisma.CrmTaskWhereInput {
  return { tenantId: actor.tenantId, ...(!canManageCrm(actor.role) ? { OR: [
    { assignedUserId: actor.userId }, { enquiry: { assignedUserId: actor.userId } }, { opportunity: { assignedUserId: actor.userId } },
    { enquiryId: null, opportunityId: null, contact: { ownerUserId: actor.userId } },
  ] } : {}) }
}
function dto(record: Loaded, actor: CrmActor) {
  const { enquiry, opportunity, ...data } = record
  const source = enquiry || opportunity
  const canViewParent = permits(actor, enquiry ? "enquiries.read" : "opportunities.read") && !!source && (canManageCrm(actor.role) || source.assignedUserId === actor.userId)
  return { ...data, enquiryId: canViewParent ? record.enquiryId : null, opportunityId: canViewParent ? record.opportunityId : null,
    parent: canViewParent ? { id: source.id, title: source.title, kind: enquiry ? "enquiry" : "opportunity" } : null,
    canEdit: permits(actor, "activities.edit") && (canManageCrm(actor.role) || record.assignedUserId === actor.userId) }
}
export function createWorkService({ run, audit, checkAssignee }: Context, extensions: Pick<CrmExtensions, "filters">) {
  async function zone(tx: Tx, actor: CrmActor) {
    return (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
  }
  async function find(tx: Tx, actor: CrmActor, id: string, edit = false) {
    const record = await tx.crmTask.findFirst({ where: { AND: [workScope(actor), { id }] }, include })
    if (!record) throw new CrmError(404, "Activity not found.")
    if (edit && !canManageCrm(actor.role) && record.assignedUserId !== actor.userId) throw new CrmError(403, "Only the assigned staff member or a manager can change this activity.")
    return record
  }
  function requireOpen(record: CrmTask) {
    if (!openStatuses.includes(record.status as typeof openStatuses[number])) throw new CrmError(409, "This activity is already closed. Add a note or schedule another activity.")
  }
  async function log(tx: Tx, actor: CrmActor, id: string, event: string, message: string, before?: unknown, after?: unknown) {
    await tx.crmTaskEvent.create({ data: { tenantId: actor.tenantId, taskId: id, actorUserId: actor.userId, event, message } })
    await audit(tx, actor, event, id, before ? snapshot(before) : undefined, after ? snapshot(after) : undefined)
  }
  async function schedule(tx: Tx, actor: CrmActor, data: WorkScheduleInput, before?: CrmTask) {
    requireWriteFields(actor, "activities", before, data)
    await checkAssignee(tx, actor, data.assignedUserId)
    const timeZone = await zone(tx, actor)
    if (data.startsAt && businessDate(new Date(data.startsAt), timeZone) !== data.dueOn) throw new CrmError(400, "The due date must match the start date in the business time zone.")
    return { ...data, ...await resolveActivityType(tx, actor, data, before), dueOn: new Date(`${data.dueOn}T00:00:00Z`), startsAt: data.startsAt ? new Date(data.startsAt) : null, endsAt: data.endsAt ? new Date(data.endsAt) : null, reminderAt: data.reminderAt ? new Date(data.reminderAt) : null }
  }
  async function create(tx: Tx, actor: CrmActor, data: WorkCreateInput, previous?: Loaded, origin?: { planLaunchId: string; planPosition: number } | { followUpRuleId: string; followUpRuleName: string; followUpRuleVersion: number; automationDepth: number }) {
    requirePermission(actor, "activities.create")
    const { contactId, enquiryId, opportunityId, completion, ...fields } = data
    const contact = await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: contactId, archived: false } })
    if (!contact) throw new CrmError(404, "Active contact not found.")
    if (!previous) {
      if (enquiryId && !await tx.crmEnquiry.findFirst({ where: { ...enquiryScope(actor), id: enquiryId, contactId } })) throw new CrmError(404, "Matching enquiry not found.")
      if (opportunityId && !await tx.crmOpportunity.findFirst({ where: { ...enquiryScope(actor), id: opportunityId, contactId } })) throw new CrmError(404, "Matching opportunity not found.")
    }
    const prepared = await schedule(tx, actor, fields)
    const record = await tx.crmTask.create({ data: { ...prepared, ...origin, tenantId: actor.tenantId, contactId, enquiryId: enquiryId || null, opportunityId: opportunityId || null, createdByUserId: actor.userId, followUpOfId: previous?.id }, include })
    await log(tx, actor, record.id, "crm.work.created", previous ? "Next follow-up scheduled." : "Activity scheduled.", undefined, record)
    if (completion) return complete(tx, actor, record, { ...completion, version: record.version }, false)
    return record
  }
  async function complete(tx: Tx, actor: CrmActor, before: Loaded, data: ReturnType<typeof workCompleteSchema.parse>, useRules = true) {
    requireOpen(before)
    if (before.version !== data.version) throw new CrmError(409, "This activity changed. Refresh before completing it.")
    if (!canManageCrm(actor.role) && before.assignedUserId !== actor.userId) throw new CrmError(403, "Only the assignee or a manager can complete this activity.")
    if (!(workOutcomes[before.type] as readonly string[]).includes(data.outcome)) throw new CrmError(400, "Choose an outcome appropriate for this activity type.")
    if (Date.parse(data.occurredAt) > Date.now() + 60000) throw new CrmError(400, "An interaction cannot be logged in the future.")
    const preparedRule = useRules ? await prepareRuleFollowUp(tx, actor, before, data.outcome) : { rule: null, schedule: null, blockedReason: null }
    const decision = data.ruleDecision
    if (preparedRule.rule) {
      const { rule, schedule: next } = preparedRule
      if (!decision || decision.id !== rule.id || decision.version !== rule.version) throw new CrmError(409, "Review the current follow-up rule before completing this activity.")
      if (decision.action === "APPLY") {
        if (data.followUp) throw new CrmError(400, "Choose the rule or a manual follow-up, not both.")
        if (!next) throw new CrmError(409, preparedRule.blockedReason || "This rule cannot create a follow-up.")
        if (decision.dueOn !== next.dueOn || decision.reminderAt !== next.reminderAt) throw new CrmError(409, "The follow-up schedule changed. Review it again before completing.")
        await create(tx, actor, { ...next, contactId: before.contactId, enquiryId: before.enquiryId || "", opportunityId: before.opportunityId || "" }, before,
          { followUpRuleId: rule.id, followUpRuleName: rule.name, followUpRuleVersion: rule.version, automationDepth: before.automationDepth + 1 })
        await log(tx, actor, before.id, "crm.work.rule.applied", `Follow-up rule applied: ${rule.name}.`, undefined, { ruleId: rule.id, version: rule.version, dueOn: next.dueOn })
      } else {
        if (!decision.reason) throw new CrmError(400, "Record why the suggested follow-up is being skipped.")
        await log(tx, actor, before.id, "crm.work.rule.skipped", `Follow-up rule skipped (${rule.name}): ${decision.reason}`, undefined, snapshot(decision))
      }
    } else if (decision) throw new CrmError(409, "The follow-up rule no longer applies. Refresh before completing.")
    // Validate/create the next activity before closing so assigned staff retain contact access.
    if (data.followUp) await create(tx, actor, { ...data.followUp, contactId: before.contactId, enquiryId: before.enquiryId || "", opportunityId: before.opportunityId || "" }, before)
    const updated = await tx.crmTask.updateMany({ where: { tenantId: actor.tenantId, id: before.id, version: data.version, status: { in: [...openStatuses] } }, data: {
      status: "COMPLETED", completedAt: new Date(), completedByUserId: actor.userId, occurredAt: new Date(data.occurredAt), durationMinutes: data.durationMinutes,
      summary: data.summary, outcome: data.outcome, version: { increment: 1 },
    } })
    if (!updated.count) throw new CrmError(409, "This activity changed. Refresh before completing it.")
    const after = await tx.crmTask.findFirstOrThrow({ where: { tenantId: actor.tenantId, id: before.id }, include })
    await log(tx, actor, before.id, "crm.work.completed", `${data.outcome}: ${data.summary}`, before, after)
    return after
  }
  return {
    ...createPlanService({ run, audit, checkAssignee, createWork: (tx, actor, data, origin) => create(tx, actor, data, undefined, origin) }),
    previewWorkFollowUp(id: string, input: unknown) {
      const query = workRulePreviewSchema.parse(input)
      return run("activities.read", async (tx, actor) => {
        const record = await find(tx, actor, id, true); requireOpen(record)
        if (record.version !== query.version) throw new CrmError(409, "This activity changed. Refresh before reviewing its next step.")
        if (!(workOutcomes[record.type] as readonly string[]).includes(query.outcome)) throw new CrmError(400, "Choose an outcome appropriate for this activity type.")
        const preview = await prepareRuleFollowUp(tx, actor, record, query.outcome)
        if (preview.rule && (!permits(actor, "activities.create") || (record.assignedUserId !== actor.userId && !permits(actor, "activities.assign")))) return { ...preview, schedule: null, blockedReason: "Your access role cannot create this follow-up. Skip the suggestion with a reason or ask your administrator." }
        return preview
      })
    },
    listWork(input: unknown) {
      const query = workListSchema.parse(input)
      return run("activities.read", async (tx, actor) => {
        const timeZone = await zone(tx, actor), now = new Date(), today = businessDate(now, timeZone)
        const filter: Prisma.CrmTaskWhereInput = {
          contactId: query.contactId, enquiryId: query.enquiryId, opportunityId: query.opportunityId, type: query.type, activityTypeId: query.activityTypeId, planLaunchId: query.planLaunchId,
          title: { contains: query.q, mode: "insensitive" },
          ...(query.state === "open" ? { status: { in: [...openStatuses] } } : query.state === "completed" ? { status: "COMPLETED" } : query.state === "cancelled" ? { status: "CANCELLED" } : {}),
        }
        const clauses: Prisma.CrmTaskWhereInput[] = [workScope(actor), filter]
        const extensionFilter = await extensions.filters(tx, actor, query)
        if (extensionFilter.work) clauses.push(extensionFilter.work)
        if (query.scope === "mine" || query.due === "reminders") clauses.push({ assignedUserId: actor.userId })
        if (query.assignedUserId) clauses.push({ assignedUserId: query.assignedUserId })
        if (query.completedFrom && query.completedThrough) clauses.push({ status: "COMPLETED", completedAt: {
          gte: startOfBusinessDate(query.completedFrom, timeZone),
          lt: startOfBusinessDate(new Date(Date.parse(`${query.completedThrough}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), timeZone),
        } })
        if (query.due === "overdue") clauses.push({ status: { in: [...openStatuses] }, OR: [{ startsAt: { lt: now } }, { startsAt: null, dueOn: { lt: new Date(`${today}T00:00:00Z`) } }] })
        if (query.due === "today") clauses.push({ dueOn: new Date(`${today}T00:00:00Z`) })
        if (query.due === "upcoming") clauses.push({ dueOn: { gt: new Date(`${today}T00:00:00Z`) } })
        if (query.due === "reminders") clauses.push({ status: { in: [...openStatuses] }, reminderAt: { lte: now }, reminderDismissedAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] })
        if (query.from && query.to) clauses.push({ OR: [
          { startsAt: null, dueOn: { gte: new Date(`${query.from}T00:00:00Z`), lt: new Date(`${query.to}T00:00:00Z`) } },
          { startsAt: { lt: startOfBusinessDate(query.to, timeZone) }, endsAt: { gt: startOfBusinessDate(query.from, timeZone) } },
        ] })
        const where = { AND: clauses }
        const [items, total] = await Promise.all([
          tx.crmTask.findMany({ where, include, orderBy: [{ [query.sort]: query.order }, { startsAt: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmTask.count({ where }),
        ])
        return { ...page(items.map(item => dto(item, actor)), total, query.page, query.pageSize), timeZone, currentUserId: actor.userId, canManage: canManageCrm(actor.role), serverTime: now.toISOString() }
      })
    },
    getWork(id: string) { return run("activities.read", async (tx, actor) => ({ ...dto(await find(tx, actor, id), actor), timeZone: await zone(tx, actor) })) },
    createWork(input: unknown) { const data = workCreateSchema.parse(input); return run("activities.create", async (tx, actor) => dto(await create(tx, actor, data), actor)) },
    updateWork(id: string, input: unknown) {
      const { version, status, ...data } = workUpdateSchema.parse(input)
      return run("activities.edit", async (tx, actor) => {
        const before = await find(tx, actor, id, true); requireOpen(before)
        const prepared = await schedule(tx, actor, data, before)
        const resetReminder = before.assignedUserId !== data.assignedUserId || before.reminderAt?.getTime() !== prepared.reminderAt?.getTime() || before.startsAt?.getTime() !== prepared.startsAt?.getTime() || before.dueOn.getTime() !== prepared.dueOn.getTime()
        const updated = await tx.crmTask.updateMany({ where: { tenantId: actor.tenantId, id, version, status: { in: [...openStatuses] } }, data: { ...prepared, status, followParentAssignment: false, version: { increment: 1 }, ...(resetReminder ? { snoozedUntil: null, reminderDismissedAt: null } : {}) } })
        if (!updated.count) throw new CrmError(409, "This activity changed. Refresh before saving.")
        const after = await tx.crmTask.findFirstOrThrow({ where: { tenantId: actor.tenantId, id }, include })
        await log(tx, actor, id, "crm.work.updated", `Activity updated.${before.assignedUserId !== after.assignedUserId ? ` Assigned to ${after.assignee.name || "another staff member"}.` : ""}${before.dueOn.getTime() !== after.dueOn.getTime() || before.startsAt?.getTime() !== after.startsAt?.getTime() ? ` Rescheduled to ${data.dueOn}${data.startsAt ? ` (${data.startsAt})` : ""}.` : ""}`, before, after)
        return dto(after, actor)
      })
    },
    completeWork(id: string, input: unknown) { const data = workCompleteSchema.parse(input); return run("activities.edit", async (tx, actor) => dto(await complete(tx, actor, await find(tx, actor, id, true), data), actor)) },
    cancelWork(id: string, input: unknown) {
      const data = workCancelSchema.parse(input)
      return run("activities.archive", async (tx, actor) => {
        const before = await find(tx, actor, id, true); requireOpen(before)
        const updated = await tx.crmTask.updateMany({ where: { tenantId: actor.tenantId, id, version: data.version }, data: { status: "CANCELLED", cancellationReason: data.reason, version: { increment: 1 } } })
        if (!updated.count) throw new CrmError(409, "This activity changed. Refresh before cancelling.")
        await log(tx, actor, id, "crm.work.cancelled", `Cancelled: ${data.reason}`, before, data)
        return { success: true }
      })
    },
    updateWorkReminder(id: string, input: unknown) {
      const data = workReminderSchema.parse(input)
      return run("activities.edit", async (tx, actor) => {
        const before = await find(tx, actor, id, true); requireOpen(before)
        if (before.assignedUserId !== actor.userId) throw new CrmError(403, "Reminder actions belong to the assigned staff member.")
        if (!before.reminderAt) throw new CrmError(409, "This activity has no reminder.")
        const now = new Date()
        const fields = data.action === "DISMISS" ? { reminderDismissedAt: now, snoozedUntil: null } : { reminderDismissedAt: null, snoozedUntil: new Date(now.getTime() + data.minutes! * 60000) }
        const updated = await tx.crmTask.updateMany({ where: { tenantId: actor.tenantId, id, version: data.version }, data: { ...fields, version: { increment: 1 } } })
        if (!updated.count) throw new CrmError(409, "This reminder changed. Refresh and try again.")
        await log(tx, actor, id, "crm.work.reminder.updated", data.action === "DISMISS" ? "Reminder dismissed; activity remains open." : `Reminder snoozed for ${data.minutes} minutes.`, undefined, fields)
        return { success: true }
      })
    },
    listWorkHistory(id: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run("activities.read", async (tx, actor) => {
        await find(tx, actor, id)
        const where = { tenantId: actor.tenantId, taskId: id }
        const [items, total] = await Promise.all([tx.crmTaskEvent.findMany({ where, include: { actor: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmTaskEvent.count({ where })])
        return page(items, total, query.page, query.pageSize)
      })
    },
    addWorkNote(id: string, input: unknown) {
      const data = crmNoteSchema.parse(input)
      return run("activities.edit", async (tx, actor) => { await find(tx, actor, id, true); await log(tx, actor, id, "crm.work.note.added", data.message, undefined, data); return { success: true } })
    },
    listContactInteractions(contactId: string, input: unknown) {
      const query = crmListSchema.parse(input)
      return run("activities.read", async (tx, actor) => {
        if (!await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: contactId }, select: { id: true } })) throw new CrmError(404, "Contact not found.")
        // Shared customer-facing summaries only. Never expose private deal notes or task instructions.
        const where = { tenantId: actor.tenantId, contactId, status: "COMPLETED" as const, summary: { not: null } }
        const [items, total] = await Promise.all([tx.crmTask.findMany({ where, select: { id: true, type: true, activityTypeName: true, summary: true, outcome: true, callDirection: true, occurredAt: true, durationMinutes: true, completedBy: { select: { name: true } } }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmTask.count({ where })])
        return page(items, total, query.page, query.pageSize)
      })
    },
  }
}
