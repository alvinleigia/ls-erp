import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { dateKey } from "./roster-dates"
import { buildStandardScheduleMap } from "./standard-schedule"
import { workingSegments } from "./working-segments"

const templateSelect = { id: true, name: true, startTime: true, endTime: true,
  breaks: { select: { startTime: true, endTime: true } } } as const
const scheduleSelect = { id: true, startDate: true, weekOffDay1: true, weekOffDay2: true, weekOff2Weeks: true,
  blocks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] as Prisma.ShiftScheduleBlockOrderByWithRelationInput[], select: { templateId: true, repeatDays: true, sortOrder: true, template: { select: templateSelect } } } } as const
type Template = Prisma.ShiftTemplateGetPayload<{ select: typeof templateSelect }>
function off(reason: string) { return { template: null as Template | null, segments: [] as { start: number; end: number }[], reason } }

// Source-detail adapter for roster history; never use this for booking integrity.
// Batch the whole requested range, then cache each schedule's rotation once.
// Profile ownership is checked even when the tenant has a default schedule.
export async function loadStandardAvailability(db: Prisma.TransactionClient, tenantId: string,
  staffProfileIds: string[], start: Date, end: Date) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const ids = [...new Set(staffProfileIds.filter(Boolean))]
  if (!ids.length) return () => off("No shift schedule assigned for this staff.")
  const [profiles, assignments, defaultSchedule] = await Promise.all([
    db.staffProfile.findMany({ where: { id: { in: ids }, user: { tenantId }, schedulingMode: "STANDARD" }, select: { id: true } }),
    db.staffScheduleAssignment.findMany({ where: {
      staffProfileId: { in: ids }, staffProfile: { user: { tenantId } }, schedule: { tenantId },
      startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }],
    }, orderBy: [{ startDate: "desc" }, { id: "desc" }],
    select: { staffProfileId: true, startDate: true, endDate: true, schedule: { select: scheduleSelect } } }),
    db.shiftSchedule.findFirst({ where: { tenantId, isDefault: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: scheduleSelect }),
  ])
  const owned = new Set(profiles.map(profile => profile.id))
  const byStaff = new Map<string, typeof assignments>()
  const schedules = new Map<string, Map<string, string | null>>()
  const templates = new Map<string, Template>()
  for (const schedule of [...assignments.map(assignment => assignment.schedule), ...(defaultSchedule ? [defaultSchedule] : [])]) {
    if (schedules.has(schedule.id)) continue
    schedules.set(schedule.id, buildStandardScheduleMap(schedule, start, end))
    for (const block of schedule.blocks) templates.set(block.templateId, block.template)
  }
  for (const assignment of assignments) {
    const group = byStaff.get(assignment.staffProfileId) ?? []
    group.push(assignment); byStaff.set(assignment.staffProfileId, group)
  }
  return (staffProfileId: string, day: Date) => {
    if (!owned.has(staffProfileId)) return off("Staff profile not found.")
    const assignment = byStaff.get(staffProfileId)?.find(item => item.startDate <= day && (!item.endDate || item.endDate >= day))
    const schedule = assignment?.schedule ?? defaultSchedule
    if (!schedule) return off("No shift schedule assigned for this staff.")
    const id = schedules.get(schedule.id)?.get(dateKey(day))
    const template = id ? templates.get(id) : null
    if (!template) return off("This date is a week off / non-working day.")
    return { template, segments: workingSegments(template), reason: "" }
  }
}
