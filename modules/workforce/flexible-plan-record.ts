import type { WorkforceOffice } from "@/types/shifts"
import type { Prisma, Weekday } from "@prisma/client"
import { dateKey } from "./roster-dates"
import { BusinessError } from "@/platform/policy"

export function planStaffScope(tenantId: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  return { user: { tenantId, role: "STAFF" as const } }
}
export const dayInclude = { slots: { include: { breaks: true } } } as const
export const weekPlanInclude = { days: { include: dayInclude }, staffProfile: { select: { userId: true } } } satisfies Prisma.StaffFlexibleWeekPlanInclude
export const patternInclude = {
  weeks: { include: { days: { include: dayInclude } } },
  staffProfile: { select: { id: true, userId: true, schedulingMode: true, user: { select: { name: true, email: true } } } },
} satisfies Prisma.StaffFlexiblePatternInclude
export type PatternRecord = Prisma.StaffFlexiblePatternGetPayload<{ include: typeof patternInclude }>
export const weekdayOrder: Weekday[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
type StoredDay = Prisma.StaffFlexibleWeekDayGetPayload<{ include: typeof dayInclude }>
export function mapPlanDays(days: Array<Pick<StoredDay, "id" | "day" | "isOff" | "sortOrder" | "slots">>) {
  return [...days].sort((a, b) => a.sortOrder - b.sortOrder || weekdayOrder.indexOf(a.day) - weekdayOrder.indexOf(b.day)).map(day => ({
    id: day.id, day: day.day, isOff: day.isOff, sortOrder: day.sortOrder,
    slots: [...day.slots].sort((a, b) => a.sortOrder - b.sortOrder).map(slot => ({
      id: slot.id, startTime: slot.startTime, endTime: slot.endTime, sortOrder: slot.sortOrder,
      breaks: [...slot.breaks].sort((a, b) => a.sortOrder - b.sortOrder).map(item => ({ id: item.id, startTime: item.startTime, endTime: item.endTime, sortOrder: item.sortOrder })),
    })),
  }))
}
export function mapWeekPlan(row: Prisma.StaffFlexibleWeekPlanGetPayload<{ include: typeof weekPlanInclude }> & { office?: WorkforceOffice | null }) {
  return { id: row.id, officeId: row.officeId, office: row.office ?? null, staffId: row.staffProfile.userId, staffProfileId: row.staffProfileId, weekStartDate: dateKey(row.weekStartDate), days: mapPlanDays(row.days) }
}
export function mapPattern(row: PatternRecord & { office?: WorkforceOffice | null }) {
  return { id: row.id, officeId: row.officeId, office: row.office ?? null, staffId: row.staffProfile.userId, staffProfileId: row.staffProfileId, name: row.name,
    cycleLengthWeeks: row.cycleLengthWeeks, validFrom: dateKey(row.validFrom), validTo: row.validTo ? dateKey(row.validTo) : null, isActive: row.isActive,
    weeks: [...row.weeks].sort((a, b) => a.weekIndex - b.weekIndex).map(week => ({ id: week.id, weekIndex: week.weekIndex, days: mapPlanDays(week.days) })),
  }
}
export function patternOverlap(start: string, end?: string | null): Prisma.StaffFlexiblePatternWhereInput {
  return { ...(end ? { validFrom: { lte: new Date(end) } } : {}), OR: [{ validTo: null }, { validTo: { gte: new Date(start) } }] }
}
