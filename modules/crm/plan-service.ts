import type { Prisma } from "@prisma/client"
import { CrmError, canManageCrm, contactScope, enquiryScope, type CrmActor } from "./policy"
import { activityPlanSchema, activityPlanUpdateSchema, applyPlanSchema } from "./plan-validation"
import { crmListSchema } from "./validation"
import { wallTimeToInstant } from "./work-time"
import { workCreateSchema, type WorkCreateInput } from "./work-validation"

type Tx = Prisma.TransactionClient
type Context = {
  run: <T>(operation: (tx: Tx, actor: CrmActor) => Promise<T>) => Promise<T>
  audit: (tx: Tx, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
  checkAssignee: (tx: Tx, actor: CrmActor, id: string) => Promise<void>
  createWork: (tx: Tx, actor: CrmActor, data: WorkCreateInput, origin: { planLaunchId: string; planPosition: number }) => Promise<{ id: string }>
}
const snapshot = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
export function createPlanService({ run, audit, checkAssignee, createWork }: Context) {
  const manage = (actor: CrmActor) => { if (!canManageCrm(actor.role)) throw new CrmError(403, "Only a manager can configure activity plans.") }
  async function find(tx: Tx, actor: CrmActor, id: string) {
    const plan = await tx.crmActivityPlan.findFirst({ where: { tenantId: actor.tenantId, id } })
    if (!plan) throw new CrmError(404, "Activity plan not found.")
    return plan
  }
  async function prepare(tx: Tx, actor: CrmActor, id: string, data: ReturnType<typeof applyPlanSchema.parse>) {
    const plan = await find(tx, actor, id)
    if (plan.archived) throw new CrmError(409, "Restore the plan before applying it.")
    if (plan.version !== data.version) throw new CrmError(409, "This plan changed. Reload it and review the schedule.")
    await checkAssignee(tx, actor, data.assignedUserId)
    if (!await tx.crmContact.findFirst({ where: { ...contactScope(actor), id: data.contactId, archived: false } })) throw new CrmError(404, "Active contact not found.")
    if (data.enquiryId && !await tx.crmEnquiry.findFirst({ where: { ...enquiryScope(actor), id: data.enquiryId, contactId: data.contactId, status: { not: "CLOSED" } } })) throw new CrmError(404, "Matching open enquiry not found.")
    if (data.opportunityId && !await tx.crmOpportunity.findFirst({ where: { ...enquiryScope(actor), id: data.opportunityId, contactId: data.contactId, stage: { kind: "OPEN", archived: false }, pipeline: { archived: false } } })) throw new CrmError(404, "Matching active opportunity not found.")
    const timeZone = (await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }))?.timeZone || "UTC"
    const template = activityPlanSchema.parse({ name: plan.name, description: plan.description || "", steps: plan.steps })
    const steps = template.steps.map(step => {
      const dueOn = new Date(Date.parse(`${data.startOn}T00:00:00Z`) + step.dayOffset * 86400000).toISOString().slice(0, 10)
      let reminderAt: string | null = null
      try { if (step.reminderTime) reminderAt = wallTimeToInstant(`${dueOn}T${step.reminderTime}`, timeZone) }
      catch (error) { throw new CrmError(400, `${step.title}: ${(error as Error).message} Change the start date or template reminder time.`) }
      return workCreateSchema.parse({ title: step.title, type: step.type, priority: step.priority, description: step.description, callDirection: step.callDirection, dueOn, reminderAt,
        contactId: data.contactId, assignedUserId: data.assignedUserId, enquiryId: data.enquiryId, opportunityId: data.opportunityId })
    })
    const targetKey = data.opportunityId ? `opportunity:${data.opportunityId}` : data.enquiryId ? `enquiry:${data.enquiryId}` : `contact:${data.contactId}`
    return { plan, steps, targetKey, timeZone }
  }
  return {
    listActivityPlans(input: unknown) {
      const query = crmListSchema.parse(input)
      return run(async (tx, actor) => {
        const where = { tenantId: actor.tenantId, archived: query.archived === "true", name: { contains: query.q, mode: "insensitive" as const } }
        const [items, total] = await Promise.all([tx.crmActivityPlan.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), tx.crmActivityPlan.count({ where })])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), canManage: canManageCrm(actor.role) }
      })
    },
    getActivityPlan(id: string) { return run(async (tx, actor) => ({ ...await find(tx, actor, id), canManage: canManageCrm(actor.role) })) },
    createActivityPlan(input: unknown) {
      const data = activityPlanSchema.parse(input)
      return run(async (tx, actor) => { manage(actor); const plan = await tx.crmActivityPlan.create({ data: { ...data, tenantId: actor.tenantId, steps: snapshot(data.steps) } }); await audit(tx, actor, "crm.plan.created", plan.id, undefined, snapshot(data)); return plan })
    },
    updateActivityPlan(id: string, input: unknown) {
      const { version, ...data } = activityPlanUpdateSchema.parse(input)
      return run(async (tx, actor) => {
        manage(actor); const before = await find(tx, actor, id)
        const updated = await tx.crmActivityPlan.updateMany({ where: { tenantId: actor.tenantId, id, version }, data: { ...data, steps: snapshot(data.steps), version: { increment: 1 } } })
        if (!updated.count) throw new CrmError(409, "This plan changed. Refresh before saving.")
        await audit(tx, actor, "crm.plan.updated", id, snapshot(before), snapshot(data))
        return tx.crmActivityPlan.findFirstOrThrow({ where: { tenantId: actor.tenantId, id } })
      })
    },
    previewActivityPlan(id: string, input: unknown) {
      const data = applyPlanSchema.parse(input)
      return run(async (tx, actor) => { const { steps, timeZone, plan } = await prepare(tx, actor, id, data); return { steps, timeZone, planName: plan.name, version: plan.version } })
    },
    applyActivityPlan(id: string, input: unknown) {
      const data = applyPlanSchema.parse(input)
      return run(async (tx, actor) => {
        const existing = await tx.crmPlanLaunch.findUnique({ where: { tenantId_requestKey: { tenantId: actor.tenantId, requestKey: data.requestKey } } })
        if (existing) {
          const same = existing.actorUserId === actor.userId && existing.planId === id && Object.entries(data).every(([key, value]) => (existing.input as Record<string, unknown>)[key] === value)
          if (!same) throw new CrmError(409, "This request was already used for a different plan application.")
          return { id: existing.id, count: (existing.steps as unknown[]).length, reused: true }
        }
        const { plan, steps, targetKey } = await prepare(tx, actor, id, data)
        if (await tx.crmPlanLaunch.findFirst({ where: { tenantId: actor.tenantId, planId: id, targetKey, workItems: { some: { status: { in: ["OPEN", "IN_PROGRESS"] } } } } })) throw new CrmError(409, "This plan already has open activities on this record. Complete or cancel those activities before applying it again.")
        const launch = await tx.crmPlanLaunch.create({ data: { tenantId: actor.tenantId, planId: id, actorUserId: actor.userId, requestKey: data.requestKey, targetKey, planName: plan.name, planVersion: plan.version, input: snapshot(data), steps: snapshot(steps) } })
        for (const [planPosition, step] of steps.entries()) await createWork(tx, actor, step, { planLaunchId: launch.id, planPosition })
        await audit(tx, actor, "crm.plan.applied", id, undefined, snapshot({ launchId: launch.id, targetKey, count: steps.length, version: plan.version }))
        return { id: launch.id, count: steps.length, reused: false }
      })
    },
  }
}
