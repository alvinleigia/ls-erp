import { planTransaction, auditPlan } from "./plan-transaction"
import { protectPlanBookings } from "./plan-bookings"
import { Prisma } from "@prisma/client"
import type { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { captureScheduleHistory, scheduleHistorySelect } from "./plan-history"
import type { ShiftScheduleInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { officeAllowed } from "@/platform/companies/office-access"
import { requirePermission } from "@/platform/access/policy"
import { shiftScheduleListSchema, type WorkforceDateRangeQuery } from "./schedule-validation"

const scheduleBlocks = {
  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  include: { template: { select: { id: true, name: true } } },
} satisfies Prisma.ShiftScheduleBlockFindManyArgs
const scheduleInclude = {
  blocks: scheduleBlocks,
  assignments: { orderBy: { id: "asc" }, include: { staffProfile: { select: { user: { select: { id: true, name: true, email: true } } } } } },
} satisfies Prisma.ShiftScheduleInclude
function requireTenant(tenantId: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
}

async function resolveScheduleStaff(tx: Prisma.TransactionClient, tenantId: string, inputIds: string[]) {
  const staffIds = [...new Set(inputIds.map(id => id.trim()))]
  if (!staffIds.length) throw new BusinessError(400, "Select at least one staff member.")
  const users = await tx.user.findMany({
    where: { tenantId, id: { in: staffIds } },
    select: { id: true, role: true, staffProfile: { select: { id: true, schedulingMode: true } } },
  })
  // Reject the entire save instead of silently omitting invalid/foreign users.
  if (users.length !== staffIds.length || users.some(user => !user.staffProfile && user.role !== "STAFF")) {
    throw new BusinessError(404, "One or more staff profiles were not found in this tenant.")
  }
  if (users.some(user => user.staffProfile?.schedulingMode === "FLEXIBLE")) {
    throw new BusinessError(409, "Flexible-mode staff cannot be assigned to shift schedules.")
  }
  if (users.some(user => !user.staffProfile)) throw new BusinessError(400, "Set up the staff profile and workplace before assigning schedules.")
  const profiles = users.map(user => user.staffProfile!)
  return profiles
}

async function assertNoAssignmentOverlap(tx: Prisma.TransactionClient, tenantId: string, staffProfileIds: string[], startDate: Date, endDate: Date | null, exclude?: { scheduleId?: string; assignmentId?: string }) {
  const conflict = await tx.staffScheduleAssignment.findFirst({
    where: {
      schedule: { tenantId }, staffProfile: { user: { tenantId } },
      staffProfileId: { in: staffProfileIds },
      ...(exclude?.scheduleId ? { scheduleId: { not: exclude.scheduleId } } : {}),
      ...(exclude?.assignmentId ? { id: { not: exclude.assignmentId } } : {}),
      ...(endDate ? { startDate: { lte: endDate } } : {}),
      OR: [{ endDate: null }, { endDate: { gte: startDate } }],
    }, select: { id: true },
  })
  if (conflict) throw new BusinessError(409, "Selected staff already have schedules assigned in this range.")
}

// Services receive parsed input within withWorkforceApi's authorized tenant context.
export async function listShiftSchedules(tenantId: string, query: z.infer<typeof shiftScheduleListSchema>) {
  requireTenant(tenantId)
  const { q, staffId, isDefault, startDate, sort, order, page = 1, pageSize } = query
  const where: Prisma.ShiftScheduleWhereInput = {
    tenantId,
    ...(staffId ? { assignments: { some: { staffProfile: { userId: staffId, user: { tenantId } } } } } : {}),
    ...(isDefault ? { isDefault: true } : {}),
    ...(startDate ? { startDate: new Date(startDate) } : {}),
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
  }
  const orderBy: Prisma.ShiftScheduleOrderByWithRelationInput = sort === "createdAt" ? { createdAt: order }
    : sort === "updatedAt" ? { updatedAt: order } : sort === "startDate" ? { startDate: order } : { startDate: "asc" }
  const [total, items] = await prisma.$transaction([
    prisma.shiftSchedule.count({ where }),
    prisma.shiftSchedule.findMany({ where, include: scheduleInclude, orderBy, skip: pageSize ? (page - 1) * pageSize : undefined, take: pageSize }),
  ])
  const labels = items.length ? await prisma.$queryRaw<{ id: string; office: { id: string; name: string; companyName: string; active: boolean } | null }[]>`SELECT s.id,app.schedule_office_label(${tenantId},s.id) AS office FROM "ShiftSchedule" s WHERE s."tenantId"=${tenantId} AND s.id=ANY(${items.map(item => item.id)}::text[])` : []
  const officeLabels = new Map(labels.map(row => [row.id, row.office]))
  const effectivePageSize = pageSize ?? (total || 1)
  return { items: items.map(item => ({ ...item, office: officeLabels.get(item.id) ?? null })), page, pageSize: effectivePageSize, total, totalPages: Math.max(1, Math.ceil(total / effectivePageSize)) }
}

export async function saveShiftSchedule(actor: BusinessActor, data: ShiftScheduleInput, id?: string) {
  const { tenantId } = actor
  return planTransaction(actor, "shiftSchedules", id ? "edit" : "create", async (tx, actor) => {
    requirePermission(actor, "shiftTemplates.read")
    const current = id ? await tx.shiftSchedule.findFirst({ where: { tenantId, id }, include: scheduleInclude }) : null
    if (id && !current) throw new BusinessError(404, "Schedule not found.")
    const officeId = current?.officeId ?? (await tx.$queryRaw<{ id: string | null }[]>`SELECT app.creation_office_id() AS id`)[0]?.id
    if (!officeId) throw new BusinessError(403, "Select an office and reload the creation form.")
    if (!await officeAllowed(tx, actor, officeId)) throw new BusinessError(403, "Schedule office access is not permitted.")
    const today = new Date().toISOString().slice(0, 10)
    if (data.startDate < today && (!current || current.startDate.toISOString().slice(0, 10) !== data.startDate)) throw new BusinessError(400, "Schedule start date cannot be in the past.")
    if (!data.isDefault && data.assignmentStartDate && data.assignmentStartDate < today && (!current || current.assignments[0]?.startDate.toISOString().slice(0, 10) !== data.assignmentStartDate)) throw new BusinessError(400, "Assignment start date cannot be in the past.")
    const templateIds = [...new Set(data.blocks.map(block => block.templateId))]
    if (await tx.shiftTemplate.count({ where: { tenantId, id: { in: templateIds } } }) !== templateIds.length) {
      throw new BusinessError(400, "One or more shift templates were not found in this tenant.")
    }
    const assignmentStart = new Date(data.assignmentStartDate || data.startDate)
    const assignmentEnd = data.assignmentEndDate ? new Date(data.assignmentEndDate) : null
    const currentIds = current?.assignments.map(a => a.staffProfile.user.id).sort() ?? []
    const preserveAssignments = !!current && !current.isDefault && !data.isDefault && JSON.stringify([...new Set(data.staffIds)].sort()) === JSON.stringify(currentIds)
      && current.assignments[0]?.startDate.getTime() === assignmentStart.getTime()
      && (current.assignments[0]?.endDate?.getTime() ?? null) === (assignmentEnd?.getTime() ?? null)
    const profiles = data.isDefault ? [] : preserveAssignments ? current!.assignments.map(a => ({ id: a.staffProfileId })) : await resolveScheduleStaff(tx, tenantId, data.staffIds)
    if (profiles.length && !preserveAssignments) await assertNoAssignmentOverlap(tx, tenantId, profiles.map(profile => profile.id), assignmentStart, assignmentEnd, { scheduleId: id })

    const checkBookings = await protectPlanBookings(tx, tenantId, {
      schedulingMode: "STANDARD",
      ...(!(current?.isDefault || data.isDefault) ? { id: { in: [...new Set([...profiles.map(p => p.id), ...(current?.assignments.map(a => a.staffProfileId) ?? [])])] } } : {}),
    })
    if (current) await captureScheduleHistory(tx, tenantId, current)
    let previousDefaults: { id: string; isDefault: boolean }[] = []
    if (data.isDefault) {
      const previous = await tx.shiftSchedule.findMany({ where: { tenantId, officeId, isDefault: true, ...(id ? { id: { not: id } } : {}) }, select: scheduleHistorySelect })
      // Check displaced defaults while holding the lock, including concurrent creates.
      if (previous.length) requirePermission(actor, "shiftSchedules.edit")
      previousDefaults = previous.map(schedule => ({ id: schedule.id, isDefault: schedule.isDefault }))
      for (const schedule of previous) await captureScheduleHistory(tx, tenantId, schedule)
      await tx.shiftSchedule.updateMany({ where: { tenantId, officeId, isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } })
    }
    const fields = {
      name: data.name?.trim() || null, isDefault: !!data.isDefault, startDate: new Date(data.startDate),
      weekOffDay1: data.weekOffDay1, weekOffDay2: data.weekOffDay2 || null,
      weekOff2Weeks: data.weekOffDay2 && !data.weekOff2Weeks.length ? [1, 2, 3, 4, 5] : data.weekOff2Weeks,
    }
    const saved = id ? await tx.shiftSchedule.update({ where: { tenantId, id }, data: fields, select: { id: true } })
      : await tx.shiftSchedule.create({ data: { tenantId, officeId, ...fields }, select: { id: true } })
    if (id) {
      await tx.shiftScheduleBlock.deleteMany({ where: { scheduleId: id, schedule: { tenantId } } })
      if (!preserveAssignments) await tx.staffScheduleAssignment.deleteMany({ where: { scheduleId: id, schedule: { tenantId }, staffProfile: { user: { tenantId } } } })
    }
    await tx.shiftScheduleBlock.createMany({ data: data.blocks.map((block, index) => ({
      scheduleId: saved.id, templateId: block.templateId, repeatDays: block.repeatDays, sortOrder: block.sortOrder ?? index,
    })) })
    if (profiles.length && !preserveAssignments) await tx.staffScheduleAssignment.createMany({ data: profiles.map(profile => ({
      scheduleId: saved.id, staffProfileId: profile.id, startDate: assignmentStart, endDate: assignmentEnd,
    })) })
    const schedule = await tx.shiftSchedule.findFirstOrThrow({ where: { tenantId, id: saved.id }, include: scheduleInclude })
    await checkBookings()
    if (previousDefaults.length) await recordDomainAuditEvent(tx, {
      tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
      event: "workforce.shiftSchedules.edit", entityType: "shiftSchedules",
      metadata: { officeId }, before: { defaultSchedules: previousDefaults }, after: { defaultSchedules: [] },
    })
    await auditPlan(tx, actor, "shiftSchedules", id ? "edit" : "create", saved.id, current, schedule)
    return { schedule }
  })
}

export async function deleteShiftSchedule(actor: BusinessActor, id: string) {
  const { tenantId } = actor
  return planTransaction(actor, "shiftSchedules", "archive", async (tx, actor) => {
    const current = await tx.shiftSchedule.findFirst({ where: { tenantId, id }, include: scheduleInclude })
    if (!current) throw new BusinessError(404, "Schedule not found.")
    const checkBookings = await protectPlanBookings(tx, tenantId, { schedulingMode: "STANDARD",
      ...(!current.isDefault ? { id: { in: current.assignments.map(a => a.staffProfileId) } } : {}),
    })
    await captureScheduleHistory(tx, tenantId, current)
    await tx.shiftSchedule.deleteMany({ where: { tenantId, id } })
    await checkBookings()
    await auditPlan(tx, actor, "shiftSchedules", "archive", id, current, { deleted: true })
    return { ok: true }
  })
}

export async function listShiftAssignments(tenantId: string, query: WorkforceDateRangeQuery) {
  requireTenant(tenantId)
  const staffIds = (query.staffIds ?? "").split(",").map(id => id.trim()).filter(Boolean)
  const assignments = await prisma.staffScheduleAssignment.findMany({
    where: {
      schedule: { tenantId }, staffProfile: { user: { tenantId, ...(staffIds.length ? { id: { in: staffIds } } : {}) } },
      startDate: { lte: new Date(query.endDate) },
      OR: [{ endDate: null }, { endDate: { gte: new Date(query.startDate) } }],
    },
    include: { schedule: { include: { blocks: scheduleBlocks } }, staffProfile: { select: { userId: true } } },
    orderBy: { startDate: "asc" },
  })
  const profiles = await prisma.staffProfile.findMany({ where: { user: { tenantId, ...(staffIds.length ? { id: { in: staffIds } } : {}) } }, select: { id: true } })
  const defaults: { staffId: string; date: Date; scheduleId: string }[] = []
  for (let offset = 0; offset < profiles.length; offset += 200) for (let start = new Date(query.startDate).getTime(); start <= new Date(query.endDate).getTime(); start += 366 * 86400000) {
    defaults.push(...await prisma.$queryRaw<typeof defaults>`SELECT * FROM app.standard_default_choices(${tenantId},${profiles.slice(offset, offset + 200).map(p => p.id)}::text[],${new Date(start).toISOString().slice(0, 10)}::date,${new Date(Math.min(new Date(query.endDate).getTime(), start + 365 * 86400000)).toISOString().slice(0, 10)}::date)`)
  }
  const sourceIds = [...new Set(defaults.map(day => day.scheduleId))]
  const defaultSchedules = sourceIds.length ? await prisma.shiftSchedule.findMany({ where: { tenantId, id: { in: sourceIds } }, include: { blocks: scheduleBlocks } }) : []
  return { defaultSchedules, items: assignments.map(({ staffProfile, ...assignment }) => ({ ...assignment, staffId: staffProfile.userId })), defaults: defaults.map(day => ({ ...day, date: day.date.toISOString().slice(0, 10) })) }
}

export async function endShiftAssignment(actor: BusinessActor, id: string, endDate: string) {
  const { tenantId } = actor
  return planTransaction(actor, "shiftSchedules", "archive", async (tx, actor) => {
    const assignment = await tx.staffScheduleAssignment.findFirst({
      where: { id, schedule: { tenantId }, staffProfile: { user: { tenantId } } },
      select: { id: true, staffProfileId: true, startDate: true, endDate: true, schedule: { select: { officeId: true } } },
    })
    if (!assignment) throw new BusinessError(404, "Assignment not found.")
    if (endDate < assignment.startDate.toISOString().slice(0, 10)) throw new BusinessError(400, "End date cannot be before assignment start date.")
    await assertNoAssignmentOverlap(tx, tenantId, [assignment.staffProfileId], assignment.startDate, new Date(endDate), { assignmentId: id })
    if (assignment.endDate?.toISOString().slice(0, 10) === endDate) return { item: { id, startDate: assignment.startDate.toISOString().slice(0, 10), endDate } }
    const checkBookings = await protectPlanBookings(tx, tenantId, { id: assignment.staffProfileId, schedulingMode: "STANDARD" })
    await captureScheduleHistory(tx, tenantId, { id, isDefault: false, startDate: assignment.startDate, assignments: [assignment] })
    const updated = await tx.staffScheduleAssignment.update({
      where: { id, schedule: { tenantId } }, data: { endDate: new Date(endDate) }, select: { id: true, startDate: true, endDate: true },
    })
    await checkBookings()
    await auditPlan(tx, actor, "shiftSchedules", "archive", id, { ...assignment, officeId: assignment.schedule.officeId }, { ...updated, officeId: assignment.schedule.officeId })
    return { item: { id: updated.id, startDate: updated.startDate.toISOString().slice(0, 10), endDate: updated.endDate?.toISOString().slice(0, 10) ?? null } }
  })
}
