import { resolveActivityTypes } from "./activity-type-service"
import type { Prisma, CrmTask } from "@prisma/client"
import { CrmError, canManageCrm, type CrmActor } from "./policy"
import { followUpRuleSchema, followUpRuleUpdateSchema } from "./follow-up-validation"
import { crmListSchema } from "./validation"
import { planStepSchema } from "./plan-validation"
import { businessDate, wallTimeToInstant } from "./work-time"
import { workScheduleSchema } from "./work-validation"

type Tx = Prisma.TransactionClient
type Context = {
  run: <T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>) => Promise<T>
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))

// Called only after the activity's read/write scope has been established.
export async function prepareRuleFollowUp(tx: Tx, actor: CrmActor, record: CrmTask, outcome: string) {
  if (record.planLaunchId) return { rule: null, schedule: null, blockedReason: "Activity plans already schedule their steps. Use a manual follow-up if needed." }
  const rule = await tx.crmFollowUpRule.findFirst({ where: { tenantId: actor.tenantId, sourceType: record.type, outcome, archived: false } })
  if (!rule) return { rule: null, schedule: null, blockedReason: null }
  const timeZone = (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
  const info = { id: rule.id, name: rule.name, version: rule.version, maxDepth: rule.maxDepth }
  const blocked = (reason: string) => ({ rule: info, schedule: null, blockedReason: reason, timeZone })
  if (record.automationDepth >= rule.maxDepth) return blocked(`The follow-up chain has reached this rule's limit of ${rule.maxDepth} generated activities.`)
  if (!await tx.crmContact.findFirst({ where: { tenantId: actor.tenantId, id: record.contactId, archived: false } })) return blocked("The customer is archived.")
  if (record.enquiryId && !await tx.crmEnquiry.findFirst({ where: { tenantId: actor.tenantId, id: record.enquiryId, status: { not: "CLOSED" } } })) return blocked("The related enquiry is closed.")
  if (record.opportunityId && !await tx.crmOpportunity.findFirst({ where: { tenantId: actor.tenantId, id: record.opportunityId, stage: { kind: "OPEN", archived: false }, pipeline: { archived: false } } })) return blocked("The related opportunity is closed or archived.")
  if (!await tx.user.findFirst({ where: { tenantId: actor.tenantId, id: record.assignedUserId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } } })) return blocked("The assigned staff member is no longer active. Reassign the activity or use a manual follow-up.")
  const step = planStepSchema.parse(rule.nextStep)
  let selected
  try { selected = (await resolveActivityTypes(tx, actor, [step]))[0] }
  catch (error) { if (error instanceof CrmError) return blocked(error.message); throw error }
  const today = businessDate(new Date(), timeZone)
  const dueOn = new Date(Date.parse(`${today}T00:00:00Z`) + step.dayOffset * 86400000).toISOString().slice(0, 10)
  let reminderAt: string | null = null
  try { if (step.reminderTime) reminderAt = wallTimeToInstant(`${dueOn}T${step.reminderTime}`, timeZone) }
  catch { return blocked("The reminder time is ambiguous or unavailable during a daylight-saving change. Use a manual follow-up or ask a manager to adjust the rule.") }
  const schedule = workScheduleSchema.parse({ title: step.title, type: step.type, activityTypeId: step.activityTypeId, priority: step.priority, description: step.description, callDirection: step.callDirection, dueOn, reminderAt, assignedUserId: record.assignedUserId })
  return { rule: info, schedule: { ...schedule, ...selected }, blockedReason: null, timeZone }
}

export function createFollowUpService({ run, audit }: Context) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can configure follow-up rules.") }
  async function find(tx: Tx, actor: CrmActor, id: string) {
    const rule = await tx.crmFollowUpRule.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!rule) throw new CrmError(404, "Follow-up rule not found.")
    return rule
  }
  return {
    listFollowUpRules(input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        const where = { tenantId: actor.tenantId, archived: query.archived === "true", name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.crmFollowUpRule.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmFollowUpRule.count({ where })])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), canManage: canManageCrm(actor.role) }
      })
    },
    getFollowUpRule(id: string) { return run(async (tx, actor) => ({ ...await find(tx, actor, id), canManage: canManageCrm(actor.role) })) },
    createFollowUpRule(input: unknown) {
      const data = followUpRuleSchema.parse(input)
      return run(async (tx, actor) => { manage(actor); await resolveActivityTypes(tx, actor, [data.nextStep]); const rule = await tx.crmFollowUpRule.create({ data: { ...data, tenantId: actor.tenantId, nextStep: snapshot(data.nextStep) } }); await audit(tx, actor, "crm.rule.created", rule.id, undefined, snapshot(data)); return rule })
    },
    updateFollowUpRule(id: string, input: unknown) {
      const { version, ...data } = followUpRuleUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        manage(actor); const before = await find(tx, actor, id)
        if (!data.archived) await resolveActivityTypes(tx, actor, [data.nextStep])
        const result = await tx.crmFollowUpRule.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...data, nextStep: snapshot(data.nextStep), version: { increment: 1 } } })
        if (!result.count) throw new CrmError(409, "This rule changed. Refresh before saving.")
        await audit(tx, actor, "crm.rule.updated", id, snapshot(before), snapshot(data))
        return tx.crmFollowUpRule.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } })
      })
    },
  }
}
