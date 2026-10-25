import type { Prisma } from "@prisma/client"
import type { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { FlexiblePatternInput, FlexibleWeekPlanInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { planTransaction, auditPlan } from "./plan-transaction"
import { captureFlexiblePlanHistory } from "./plan-history"
import { protectPlanBookings } from "./plan-bookings"
import { flexibleWriteOffice, flexibleOfficeLabels, flexibleTarget } from "./flexible-plan-office"
import { writeWeekDays, writePatternWeeks } from "./flexible-plan-write"
import { dateKey, dateKeyInTimeZone } from "./roster-dates"
import { planStaffScope, weekPlanInclude, patternInclude, mapPattern, mapWeekPlan, patternOverlap } from "./flexible-plan-record"
import { splitStaffIds, mondayDate, type weekPlanQuerySchema, type deleteWeekPlanSchema, type patternQuerySchema, type patternListSchema, type clonePatternSchema } from "./flexible-plan-validation"

function weekHistoryRange(startDate: Date) {
  const endDate = new Date(startDate)
  endDate.setUTCDate(endDate.getUTCDate() + 6)
  return { startDate, endDate }
}
async function flexibleStaff(tx: Prisma.TransactionClient, tenantId: string, staffId: string) {
  const row = await tx.staffProfile.findFirst({ where: { ...planStaffScope(tenantId), userId: staffId }, select: { id: true, schedulingMode: true } })
  if (!row) throw new BusinessError(404, "Staff profile not found.")
  if (row.schedulingMode !== "FLEXIBLE") throw new BusinessError(409, "Set staff scheduling mode to Flexible before updating a plan.")
  return row
}
export async function findPattern(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const row = await tx.staffFlexiblePattern.findFirst({ where: { tenantId, id, staffProfile: planStaffScope(tenantId) }, include: patternInclude })
  if (!row) throw new BusinessError(404, "Recurring pattern not found.")
  return row
}

export async function getWeekPlans(tenantId: string, query: z.infer<typeof weekPlanQuerySchema>) {
  const multiple = splitStaffIds(query.staffIds)
  const ids = [...new Set(multiple.length ? multiple : [query.staffId!])]
  const profiles = await prisma.staffProfile.findMany({ where: { ...planStaffScope(tenantId), userId: { in: ids } }, select: { id: true } })
  if (!profiles.length) throw new BusinessError(404, "Staff profile not found.")
  const rows = await prisma.staffFlexibleWeekPlan.findMany({ where: { tenantId, staffProfileId: { in: profiles.map(p => p.id) }, staffProfile: planStaffScope(tenantId), weekStartDate: new Date(query.weekStartDate) }, include: weekPlanInclude })
  const items = (await flexibleOfficeLabels(prisma, tenantId, "WEEK", rows)).map(mapWeekPlan)
  return { item: query.staffId && !multiple.length ? items[0] ?? null : null, items }
}
export async function saveWeekPlan(actor: BusinessActor, data: FlexibleWeekPlanInput) {
  mondayDate.parse(data.weekStartDate)
  return planTransaction(actor, "shiftRoster", "edit", async (tx, actor) => {
    const profile = await flexibleStaff(tx, actor.tenantId, data.staffId)
    const before = await tx.staffFlexibleWeekPlan.findUnique({ where: { tenantId: actor.tenantId, staffProfileId_weekStartDate: { staffProfileId: profile.id, weekStartDate: new Date(data.weekStartDate) } }, include: weekPlanInclude })
    const officeId = await flexibleWriteOffice(tx, actor, before?.officeId)
    if (!before) await flexibleTarget(tx, actor.tenantId, officeId, profile.id, data.weekStartDate, dateKey(weekHistoryRange(new Date(data.weekStartDate)).endDate))
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" })
    if (before) await captureFlexiblePlanHistory(tx, actor.tenantId, profile.id, [weekHistoryRange(before.weekStartDate)])
    const row = before
      ? await tx.staffFlexibleWeekPlan.update({ where: { id: before.id }, data: { updatedAt: new Date() }, select: { id: true } })
      : await tx.staffFlexibleWeekPlan.create({ data: { tenantId: actor.tenantId, officeId, staffProfileId: profile.id, weekStartDate: new Date(data.weekStartDate) }, select: { id: true } })
    await tx.staffFlexibleWeekDay.deleteMany({ where: { planId: row.id } })
    await writeWeekDays(tx, row.id, data.days)
    const saved = await tx.staffFlexibleWeekPlan.findUniqueOrThrow({ where: { id: row.id }, include: weekPlanInclude })
    await checkBookings()
    await auditPlan(tx, actor, "shiftRoster", "edit", row.id, before, saved)
    return { item: mapWeekPlan((await flexibleOfficeLabels(tx, actor.tenantId, "WEEK", [saved]))[0]) }
  })
}
export async function deleteWeekPlan(actor: BusinessActor, data: z.infer<typeof deleteWeekPlanSchema>) {
  return planTransaction(actor, "shiftRoster", "archive", async (tx, actor) => {
    const profile = await flexibleStaff(tx, actor.tenantId, data.staffId)
    const before = await tx.staffFlexibleWeekPlan.findFirst({ where: { tenantId: actor.tenantId, staffProfileId: profile.id, staffProfile: planStaffScope(actor.tenantId), weekStartDate: new Date(data.weekStartDate) }, include: weekPlanInclude })
    if (!before) return { deletedCount: 0 }
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" })
    await captureFlexiblePlanHistory(tx, actor.tenantId, profile.id, [weekHistoryRange(before.weekStartDate)])
    await tx.staffFlexibleWeekPlan.delete({ where: { id: before.id, staffProfile: planStaffScope(actor.tenantId) } })
    await checkBookings()
    await auditPlan(tx, actor, "shiftRoster", "archive", before.id, before, { deletedCount: 1 })
    return { deletedCount: 1 }
  })
}

export async function getPatterns(tenantId: string, query: z.infer<typeof patternQuerySchema>) {
  const ids = [...new Set([...splitStaffIds(query.staffIds), ...(query.staffId ? [query.staffId] : [])])]
  const start = query.startDate || query.endDate, end = query.endDate || query.startDate
  const rows = await prisma.staffFlexiblePattern.findMany({ where: {
    tenantId, staffProfile: { ...planStaffScope(tenantId), userId: { in: ids }, schedulingMode: "FLEXIBLE" },
    ...(start ? patternOverlap(start, end) : {}),
  }, include: patternInclude, orderBy: [{ isActive: "desc" }, { validFrom: "desc" }, { id: "asc" }] })
  return { items: (await flexibleOfficeLabels(prisma, tenantId, "PATTERN", rows)).map(mapPattern) }
}
export async function getPattern(tenantId: string, id: string) {
  return { item: mapPattern((await flexibleOfficeLabels(prisma, tenantId, "PATTERN", [await findPattern(prisma, tenantId, id)]))[0]) }
}
export async function listPatterns(tenantId: string, query: z.infer<typeof patternListSchema>) {
  const { q, staffId, isActive, effectiveOn, sort, order, page, pageSize } = query
  const where: Prisma.StaffFlexiblePatternWhereInput = {
    tenantId, staffProfile: { ...planStaffScope(tenantId), ...(staffId ? { userId: staffId } : {}) },
    ...(isActive ? { isActive: isActive === "true" } : {}),
    AND: [ ...(effectiveOn ? [patternOverlap(effectiveOn, effectiveOn)] : []), ...(q ? [{ OR: [
      { name: { contains: q, mode: "insensitive" as const } },
      { staffProfile: { user: { name: { contains: q, mode: "insensitive" as const } } } },
      { staffProfile: { user: { email: { contains: q, mode: "insensitive" as const } } } },
    ] }] : []) ],
  }
  const orderBy: Prisma.StaffFlexiblePatternOrderByWithRelationInput = sort === "validFrom" ? { validFrom: order } : sort === "createdAt" ? { createdAt: order } : { updatedAt: order }
  const [total, rows, setting] = await prisma.$transaction([
    prisma.staffFlexiblePattern.count({ where }),
    prisma.staffFlexiblePattern.findMany({ where, orderBy: [orderBy, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      include: { staffProfile: { select: { id: true, userId: true, user: { select: { name: true, email: true } } } } } }),
    prisma.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } }),
  ])
  const today = effectiveOn || dateKeyInTimeZone(new Date(), setting?.timeZone ?? "UTC")
  const items = (await flexibleOfficeLabels(prisma, tenantId, "PATTERN", rows)).map(row => ({ id: row.id, officeId: row.officeId, office: row.office, staffId: row.staffProfile.userId, staffProfileId: row.staffProfileId,
    staffName: row.staffProfile.user.name, staffEmail: row.staffProfile.user.email, name: row.name, cycleLengthWeeks: row.cycleLengthWeeks,
    validFrom: dateKey(row.validFrom), validTo: row.validTo ? dateKey(row.validTo) : null, isActive: row.isActive,
    isCurrentlyEffective: row.isActive && dateKey(row.validFrom) <= today && (!row.validTo || dateKey(row.validTo) >= today),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }))
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

async function deactivateOverlaps(tx: Prisma.TransactionClient, actor: BusinessActor, officeId: string, profileId: string, start: string, end?: string | null, excludingId?: string) {
  await tx.$executeRaw`SELECT app.check_flexible_overlap(${actor.tenantId},${officeId},${profileId},${start}::date,${end || null}::date,${excludingId ?? null})`
  const where: Prisma.StaffFlexiblePatternWhereInput = { tenantId: actor.tenantId, officeId, staffProfileId: profileId, staffProfile: planStaffScope(actor.tenantId), isActive: true,
    ...patternOverlap(start, end), ...(excludingId ? { id: { not: excludingId } } : {}) }
  const rows = await tx.staffFlexiblePattern.findMany({ where, select: { id: true, validFrom: true, validTo: true }, orderBy: { id: "asc" } })
  if (!rows.length) return
  requirePermission(actor, "shiftPlans.archive")
  await captureFlexiblePlanHistory(tx, actor.tenantId, profileId, rows.map(row => ({ startDate: row.validFrom, endDate: row.validTo })))
  const ids = rows.map(row => row.id)
  // This displacement audit stays transactional: failed saves must not retire an
  // existing pattern or leave an audit claiming that it was retired.
  await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: "workforce.shiftPlans.archive", entityType: "shiftPlans", metadata: { officeId, officeFamily: "flexiblePlans" }, before: { activePatternIds: ids }, after: { inactivePatternIds: ids } })
  await tx.staffFlexiblePattern.updateMany({ where: { ...where, id: { in: ids } }, data: { isActive: false } })
}
export async function savePattern(actor: BusinessActor, data: FlexiblePatternInput) {
  return planTransaction(actor, "shiftPlans", data.patternId ? "edit" : "create", async (tx, actor) => {
    const profile = await flexibleStaff(tx, actor.tenantId, data.staffId)
    const current = data.patternId ? await findPattern(tx, actor.tenantId, data.patternId) : null
    const officeId = await flexibleWriteOffice(tx, actor, current?.officeId)
    if (current && current.staffProfileId !== profile.id) throw new BusinessError(404, "Flexible recurring pattern not found.")
    const unchangedOrNarrowed = current && data.validFrom === dateKey(current.validFrom)
      && ((data.validTo || null) === (current.validTo ? dateKey(current.validTo) : null) || (data.validTo && (!current.validTo || data.validTo <= dateKey(current.validTo))))
      && (!data.isActive || current.isActive)
    if (!unchangedOrNarrowed) await flexibleTarget(tx, actor.tenantId, officeId, profile.id, data.validFrom, data.validTo)
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: profile.id, schedulingMode: "FLEXIBLE" })
    if (current && data.isActive !== current.isActive) requirePermission(actor, "shiftPlans.archive")
    if (current?.isActive) await captureFlexiblePlanHistory(tx, actor.tenantId, profile.id, [{ startDate: current.validFrom, endDate: current.validTo }])
    if (data.isActive) await deactivateOverlaps(tx, actor, officeId, profile.id, data.validFrom, data.validTo, current?.id)
    const fields = { name: data.name?.trim() || null, cycleLengthWeeks: data.cycleLengthWeeks, validFrom: new Date(data.validFrom), validTo: data.validTo ? new Date(data.validTo) : null, isActive: data.isActive }
    const row = current
      ? await tx.staffFlexiblePattern.update({ where: { id: current.id, staffProfile: planStaffScope(actor.tenantId) }, data: fields, select: { id: true } })
      : await tx.staffFlexiblePattern.create({ data: { ...fields, tenantId: actor.tenantId, officeId, staffProfileId: profile.id }, select: { id: true } })
    await tx.staffFlexiblePatternWeek.deleteMany({ where: { patternId: row.id } })
    await writePatternWeeks(tx, row.id, data.weeks)
    const saved = await findPattern(tx, actor.tenantId, row.id)
    await checkBookings()
    await auditPlan(tx, actor, "shiftPlans", current ? "edit" : "create", row.id, current, saved)
    return { item: mapPattern((await flexibleOfficeLabels(tx, actor.tenantId, "PATTERN", [saved]))[0]) }
  })
}
export async function clonePattern(actor: BusinessActor, id: string, data: z.infer<typeof clonePatternSchema>) {
  return planTransaction(actor, "shiftPlans", "create", async (tx, actor) => {
    const source = await findPattern(tx, actor.tenantId, id)
    const officeId = await flexibleWriteOffice(tx, actor)
    const target = await flexibleStaff(tx, actor.tenantId, data.targetStaffId ?? source.staffProfile.userId)
    await flexibleTarget(tx, actor.tenantId, officeId, target.id, data.validFrom, data.validTo)
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: target.id, schedulingMode: "FLEXIBLE" })
    // A clone is a new pattern: include its source in the overlap check when
    // cloning for the same staff member. Only editing excludes its own ID.
    if (data.activate) await deactivateOverlaps(tx, actor, officeId, target.id, data.validFrom, data.validTo)
    const row = await tx.staffFlexiblePattern.create({ data: {
      tenantId: actor.tenantId, officeId, staffProfileId: target.id, name: data.name?.trim() || source.name || null, cycleLengthWeeks: source.cycleLengthWeeks,
      validFrom: new Date(data.validFrom), validTo: data.validTo ? new Date(data.validTo) : null, isActive: data.activate,
    }, select: { id: true } })
    await writePatternWeeks(tx, row.id, source.weeks)
    const saved = await findPattern(tx, actor.tenantId, row.id)
    await checkBookings()
    // Each office's audit contains only its own record. The request ID ties the
    // source-read event to the destination creation for authorized audit review.
    await recordDomainAuditEvent(tx, {
      tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
      event: "workforce.shiftPlans.clone_source", entityType: "shiftPlans", entityId: source.id,
      metadata: { officeId: source.officeId, officeFamily: "flexiblePlans" }, after: { copied: true },
    })
    await auditPlan(tx, actor, "shiftPlans", "create", row.id, null, saved)
    return { id: row.id }
  })
}
export async function deactivatePattern(actor: BusinessActor, id: string) {
  return planTransaction(actor, "shiftPlans", "archive", async (tx, actor) => {
    const before = await findPattern(tx, actor.tenantId, id)
    if (!before.isActive) return { success: true }
    const checkBookings = await protectPlanBookings(tx, actor.tenantId, { id: before.staffProfileId, schedulingMode: "FLEXIBLE" })
    await captureFlexiblePlanHistory(tx, actor.tenantId, before.staffProfileId, [{ startDate: before.validFrom, endDate: before.validTo }])
    const saved = await tx.staffFlexiblePattern.update({ where: { id, staffProfile: planStaffScope(actor.tenantId) }, data: { isActive: false }, include: patternInclude })
    await checkBookings()
    await auditPlan(tx, actor, "shiftPlans", "archive", id, before, saved)
    return { success: true }
  })
}
