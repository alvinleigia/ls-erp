import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { ShiftTemplateInput } from "@/lib/validation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"
import { planTransaction, auditPlan } from "./plan-transaction"
import { protectPlanBookings } from "./plan-bookings"
import { captureScheduleHistory, scheduleHistorySelect } from "./plan-history"
import { syncRosterHistoryRange, normalizeHistoryRangeToPast } from "./roster-history"
import type { ListResponse } from "@/types/api"

export const shiftTemplateListSchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional().transform(value => value === "true"),
  q: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  // Existing table columns without a dedicated sort use the name fallback below.
  sort: z.string().default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
}).refine(value => (value.page === undefined) === (value.pageSize === undefined), {
  message: "Supply both page and pageSize for pagination.", path: ["pageSize"],
})

const shiftTemplateInclude = { breaks: { orderBy: { sortOrder: "asc" } } } satisfies Prisma.ShiftTemplateInclude

// Accepts validated input inside the authorized Workforce tenant context.
export async function listShiftTemplates(tenantId: string, query: z.infer<typeof shiftTemplateListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { includeInactive, q, status, sort, order, page = 1, pageSize } = query
  const where: Prisma.ShiftTemplateWhereInput = { tenantId }

  if (!includeInactive) {
    if (status === "INACTIVE") {
      where.isActive = false
    } else if (status === "ACTIVE") {
      where.isActive = true
    } else {
      where.isActive = true
    }
  } else if (status === "INACTIVE") {
    where.isActive = false
  } else if (status === "ACTIVE") {
    where.isActive = true
  } else {
  }

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ]
  }

  let orderBy: Prisma.ShiftTemplateOrderByWithRelationInput
  switch (sort) {
    case "createdAt":
      orderBy = { createdAt: order }
      break
    case "updatedAt":
      orderBy = { updatedAt: order }
      break
    default:
      orderBy = { name: order }
  }

  const total = await prisma.shiftTemplate.count({ where })
  const templates = await prisma.shiftTemplate.findMany({
    where,
    include: shiftTemplateInclude,
    orderBy,
    skip: pageSize ? (page - 1) * pageSize : undefined,
    take: pageSize ?? undefined,
  })

  const effectivePageSize = pageSize ?? (total || templates.length || 1)
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize))
  const response: ListResponse<typeof templates[number]> = {
    items: templates,
    page,
    pageSize: effectivePageSize,
    total,
    totalPages,
  }
  return response
}

function templateFields(data: ShiftTemplateInput) {
  return { name: data.name, description: data.description || null, color: data.color || null,
    isActive: data.isActive ?? true, startTime: data.startTime, endTime: data.endTime }
}
function templateBreaks(data: ShiftTemplateInput) {
  return data.breaks.map((period, index) => ({ startTime: period.startTime, endTime: period.endTime, sortOrder: period.sortOrder ?? index }))
}

export async function createShiftTemplate(actor: BusinessActor, data: ShiftTemplateInput) {
  return planTransaction(actor, "shiftTemplates", "create", async (tx, actor) => {
    if (data.isActive === false) requirePermission(actor, "shiftTemplates.archive")
    const template = await tx.shiftTemplate.create({
      data: { tenantId: actor.tenantId, ...templateFields(data), breaks: { create: templateBreaks(data) } },
      include: shiftTemplateInclude,
    })
    await auditPlan(tx, actor, "shiftTemplates", "create", template.id, null, template)
    return template
  })
}

export async function updateShiftTemplate(actor: BusinessActor, id: string, data: ShiftTemplateInput) {
  const { tenantId } = actor
  return planTransaction(actor, "shiftTemplates", "edit", async (tx, actor) => {
    const before = await tx.shiftTemplate.findFirst({ where: { tenantId, id }, include: shiftTemplateInclude })
    if (!before) throw new BusinessError(404, "Shift template not found.")
    if (before.isActive !== (data.isActive ?? true)) requirePermission(actor, "shiftTemplates.archive")
    const schedules = await tx.shiftSchedule.findMany({ where: { tenantId, blocks: { some: { templateId: id } } }, select: scheduleHistorySelect })
    const overrides = await tx.staffShiftOverride.findMany({ where: { templateId: id, staffProfile: { user: { tenantId } } }, select: { staffProfileId: true, date: true } })
    const assignedIds = [...new Set(schedules.flatMap(s => s.assignments.map(a => a.staffProfileId)))]
    const checkBookings = await protectPlanBookings(tx, tenantId, { OR: [
      { schedulingMode: "STANDARD", ...(!schedules.some(s => s.isDefault) ? { id: { in: assignedIds } } : {}) },
      { id: { in: [...new Set(overrides.map(o => o.staffProfileId))] } },
    ] })
    for (const schedule of schedules) await captureScheduleHistory(tx, tenantId, schedule)
    if (overrides.length) {
      const setting = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
      const dates = overrides.map(o => o.date.toISOString().slice(0, 10)).sort()
      const range = normalizeHistoryRangeToPast(dates[0], dates[dates.length - 1], setting?.timeZone ?? "UTC")
      if (range) await syncRosterHistoryRange(tx, { tenantId,
        staffProfileIds: [...new Set(overrides.map(o => o.staffProfileId))], ...range,
      })
    }
    await tx.shiftTemplate.update({ where: { tenantId, id }, data: templateFields(data) })
    await tx.shiftTemplateBreak.deleteMany({ where: { templateId: id, template: { tenantId } } })
    if (data.breaks.length) await tx.shiftTemplateBreak.createMany({ data: templateBreaks(data).map(b => ({ templateId: id, ...b })) })
    const after = await tx.shiftTemplate.findFirstOrThrow({ where: { tenantId, id }, include: shiftTemplateInclude })
    await checkBookings()
    await auditPlan(tx, actor, "shiftTemplates", "edit", id, before, after)
    return after
  })
}

export async function deleteShiftTemplate(actor: BusinessActor, id: string) {
  const { tenantId } = actor
  return planTransaction(actor, "shiftTemplates", "archive", async (tx, actor) => {
    const before = await tx.shiftTemplate.findFirst({ where: { tenantId, id }, include: shiftTemplateInclude })
    if (!before) throw new BusinessError(404, "Shift template not found.")
    const [blocks, overrides, history] = await Promise.all([
      tx.shiftScheduleBlock.count({ where: { templateId: id, schedule: { tenantId } } }),
      tx.staffShiftOverride.count({ where: { templateId: id, staffProfile: { user: { tenantId } } } }),
      tx.staffRosterHistoryDay.count({ where: { templateId: id, staffProfile: { user: { tenantId } } } }),
    ])
    if (blocks || overrides || history) throw new BusinessError(409, "Template is in use and cannot be deleted. Deactivate it to keep its history.")
    await tx.shiftTemplate.delete({ where: { tenantId, id } })
    await auditPlan(tx, actor, "shiftTemplates", "archive", id, before, { deleted: true })
  })
}
