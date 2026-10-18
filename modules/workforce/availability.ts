import { loadFlexibleAvailability } from "./flexible-availability"
import { prisma } from "@/lib/prisma"
import { loadStandardAvailability } from "./standard-availability"
import { workingSegments } from "./working-segments"
import { type Prisma } from "@prisma/client"

type ZonedDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

type AvailabilityCheckResult =
  | { ok: true; templateId: string | null }
  | { ok: false; reason: string }

type WorkingSegment = {
  start: number
  end: number
}

const getZonedDateParts = (value: Date, timeZone: string): ZonedDateParts => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0")

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  }
}

const resolveWorkingAvailabilityForDate = async (
  staffProfileId: string,
  dateKey: string,
  tenantId: string,
  db: Prisma.TransactionClient
) => {
  const dateValue = new Date(`${dateKey}T00:00:00.000Z`)

  const override = await db.staffShiftOverride.findUnique({
    where: { staffProfileId_date: { staffProfileId, date: dateValue }, staffProfile: { user: { tenantId } } },
    include: {
      template: {
        include: { breaks: { orderBy: { sortOrder: "asc" } } },
      },
    },
  })
  if (override) {
    if (!override.templateId || !override.template) {
      return {
        template: null,
        segments: [] as WorkingSegment[],
        reason: "Staff is unavailable on this date.",
      }
    }
    return {
      template: override.template,
      segments: workingSegments(override.template),
      reason: "",
    }
  }

  const staffProfile = await db.staffProfile.findFirst({
    where: {
      id: staffProfileId,
      user: { tenantId },
    },
    select: { schedulingMode: true },
  })
  if (!staffProfile) {
    return {
      template: null,
      segments: [] as WorkingSegment[],
      reason: "Staff profile not found.",
    }
  }

  if (staffProfile.schedulingMode === "FLEXIBLE") {
    const resolve = await loadFlexibleAvailability(db, tenantId, [staffProfileId], dateValue, dateValue)
    return { template: null, ...resolve(staffProfileId, dateValue) }
  }

  const resolve = await loadStandardAvailability(db, tenantId, [staffProfileId], dateValue, dateValue)
  return resolve(staffProfileId, dateValue)
}

export const checkStaffAppointmentAvailability = async (
  staffProfileId: string,
  startAt: Date,
  endAt: Date,
  tenantId: string,
  db: Prisma.TransactionClient = prisma
): Promise<AvailabilityCheckResult> => {
  if (!tenantId) throw new Error("Tenant context is required for staff availability.")
  const setting = await db.appSetting.findFirst({
    where: { tenantId },
    select: { timeZone: true },
  })
  const timeZone = setting?.timeZone || "America/New_York"

  const zonedStart = getZonedDateParts(startAt, timeZone)
  const zonedEnd = getZonedDateParts(endAt, timeZone)

  const dateKey = `${String(zonedStart.year).padStart(4, "0")}-${String(zonedStart.month).padStart(2, "0")}-${String(zonedStart.day).padStart(2, "0")}`
  const endDateKey = `${String(zonedEnd.year).padStart(4, "0")}-${String(zonedEnd.month).padStart(2, "0")}-${String(zonedEnd.day).padStart(2, "0")}`

  if (dateKey !== endDateKey) {
    return { ok: false, reason: "Appointment cannot span multiple local dates." }
  }

  const dateValue = new Date(`${dateKey}T00:00:00.000Z`)
  const approvedLeave = await db.leaveRequest.findFirst({
    where: {
      staffProfileId,
      staffProfile: { user: { tenantId } },
      status: "APPROVED",
      startDate: { lte: dateValue },
      endDate: { gte: dateValue },
    },
    select: {
      leaveDefinition: { select: { code: true, name: true } },
    },
  })
  if (approvedLeave) {
    const leaveLabel = `${approvedLeave.leaveDefinition.code} - ${approvedLeave.leaveDefinition.name}`
    return {
      ok: false,
      reason: `Staff member is on approved leave (${leaveLabel}) on this date.`,
    }
  }

  const { template, segments, reason } = await resolveWorkingAvailabilityForDate(
    staffProfileId,
    dateKey,
    tenantId,
    db
  )
  if (!segments.length) {
    return { ok: false, reason }
  }

  const startMinutes = zonedStart.hour * 60 + zonedStart.minute
  const endMinutes = zonedEnd.hour * 60 + zonedEnd.minute
  if (endMinutes <= startMinutes) {
    return { ok: false, reason: "Invalid appointment time range." }
  }

  const isInsideShift = segments.some(
    (segment) => startMinutes >= segment.start && endMinutes <= segment.end
  )

  if (!isInsideShift) {
    return {
      ok: false,
      reason: "Selected time falls outside staff working hours or overlaps a break.",
    }
  }

  return { ok: true, templateId: template?.id ?? null }
}
