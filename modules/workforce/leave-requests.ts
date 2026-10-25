import { startOfBusinessDate } from "@/lib/business-time"
import { BusinessError } from "@/platform/policy"
import { Prisma, Weekday, type PrismaClient } from "@prisma/client"
import type { LeaveRequestRow, LeaveRequestRuleCheck, LeaveRequestTimelineEvent } from "@/types/leaves"
import { appointmentConflictSummary } from "@/modules/appointments/booking-integrity"
import { canReadAppointmentDetails } from "@/modules/appointments/conflict-access"
import { databaseActorId } from "@/lib/database-actor"

type DbClient = PrismaClient | Prisma.TransactionClient

type ValidateCreateLeaveRequestRulesInput = {
  tx: DbClient
  tenantId: string
  staffProfileId: string
  leaveDefinitionId: string
  startDate: string
  endDate: string
}

type ValidateCreateLeaveRequestRulesResult = {
  startDate: Date
  endDate: Date
  daysCount: number
}

type LeaveRequestWithRelations = {
  officeId: string
  id: string
  staffProfileId: string
  leaveDefinitionId: string
  startDate: Date
  endDate: Date
  daysCount: number
  reason: string | null
  status: LeaveRequestRow["status"]
  reviewedByUserId: string | null
  reviewedAt: Date | null
  reviewerComment: string | null
  canceledAt: Date | null
  cancelReason: string | null
  revokedAt: Date | null
  revokedByUserId: string | null
  revokeReason: string | null
  createdAt: Date
  updatedAt: Date
  leaveDefinition: {
    id: string
    code: string
    name: string
  }
  staffProfile: {
    id: string
    managerUserId: string | null
    user: {
      id: string
      name: string | null
      email: string
      role: "ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER"
    }
  }
  reviewedByUser: {
    id: string
    name: string | null
    email: string
  } | null
  revokedByUser: {
    id: string
    name: string | null
    email: string
  } | null
}

const dayMs = 24 * 60 * 60 * 1000
const ACTIVE_APPOINTMENT_STATUSES = ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"] as const

const parseDateOnly = (value: string) => {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) {
    throw new BusinessError(400, "Invalid date format. Use YYYY-MM-DD.")
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(parsed.getTime())) {
    throw new BusinessError(400, "Invalid date supplied.")
  }
  return parsed
}

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10)

const addDays = (value: Date, offset: number) =>
  new Date(value.getTime() + offset * dayMs)

const addDaysUtc = (value: Date, offset: number) => {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + offset)
  return next
}

const getTodayDateOnlyUtc = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const getInclusiveDays = (startDate: Date, endDate: Date) =>
  Math.floor((endDate.getTime() - startDate.getTime()) / dayMs) + 1

const resolveWeekday = (value: Date): Weekday => {
  const mapping: Weekday[] = [
    Weekday.SUNDAY,
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
  ]
  return mapping[value.getUTCDay()] ?? Weekday.SUNDAY
}

const getWeekOfMonth = (value: Date) => {
  const day = value.getUTCDate()
  return Math.floor((day - 1) / 7) + 1
}

const isWeekOffForSchedule = (
  date: Date,
  schedule: {
    weekOffDay1: Weekday
    weekOffDay2: Weekday | null
    weekOff2Weeks: number[]
  } | null
) => {
  if (!schedule) return false
  const weekday = resolveWeekday(date)
  if (weekday === schedule.weekOffDay1) return true
  if (schedule.weekOffDay2 && weekday === schedule.weekOffDay2) {
    const weeks =
      schedule.weekOff2Weeks.length > 0 ? schedule.weekOff2Weeks : [1, 2, 3, 4, 5]
    return weeks.includes(getWeekOfMonth(date))
  }
  return false
}

const getScheduleForDate = async (
  tx: DbClient,
  staffProfileId: string,
  date: Date,
  tenantId: string
) => {
  const assignment = await tx.staffScheduleAssignment.findFirst({
    where: {
      staffProfileId,
      schedule: { tenantId },
      staffProfile: { user: { tenantId } },
      startDate: { lte: date },
      OR: [{ endDate: null }, { endDate: { gte: date } }],
    },
    orderBy: [{ startDate: "desc" }],
    select: {
      schedule: {
        select: {
          weekOffDay1: true,
          weekOffDay2: true,
          weekOff2Weeks: true,
        },
      },
    },
  })
  if (assignment?.schedule) return assignment.schedule

  const fallback = await tx.shiftSchedule.findFirst({
    where: { isDefault: true, tenantId },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      weekOffDay1: true,
      weekOffDay2: true,
      weekOff2Weeks: true,
    },
  })
  return fallback
}

export const validateCreateLeaveRequestRules = async ({
  tx,
  tenantId,
  staffProfileId,
  leaveDefinitionId,
  startDate,
  endDate,
}: ValidateCreateLeaveRequestRulesInput): Promise<ValidateCreateLeaveRequestRulesResult> => {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const parsedStart = parseDateOnly(startDate)
  const parsedEnd = parseDateOnly(endDate)
  if (parsedStart > parsedEnd) {
    throw new BusinessError(400, "Start date cannot be after end date.")
  }

  const daysCount = getInclusiveDays(parsedStart, parsedEnd)

  const staff = await tx.staffProfile.findUnique({
    where: { id: staffProfileId, user: { tenantId } },
    select: {
      id: true,
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          gender: true,
        },
      },
    },
  })
  if (!staff || staff.user.status !== "ACTIVE") {
    throw new BusinessError(400, "Only active staff or managers can request leave.")
  }
  if (staff.user.role !== "STAFF" && staff.user.role !== "MANAGER") {
    throw new BusinessError(400, "Only active staff or managers can request leave.")
  }

  const eligibleGroup = await tx.leaveGroup.findFirst({
    where: {
      tenantId,
      status: "ACTIVE",
      leaves: {
        some: {
          leaveDefinitionId,
        },
      },
      OR: [
        { assignmentMode: "ALL_STAFF" },
        {
          assignmentMode: "SELECTED_STAFF",
          staffAssignments: {
            some: {
              staffProfileId,
            },
          },
        },
      ],
    },
    select: { id: true },
  })
  if (!eligibleGroup) {
    throw new BusinessError(400, "Selected leave type is not assigned to this employee.")
  }

  const leaveDefinition = await tx.leaveDefinition.findUnique({
    where: { id: leaveDefinitionId, tenantId },
    select: {
      id: true,
      allowedUsers: true,
      minDaysPerRequest: true,
      maxDaysPerRequest: true,
      maxPendingRequests: true,
      allowWithOtherLeaves: true,
      priorEntryAllowed: true,
      noticeDays: true,
      weekOffSingleSideAllowed: true,
      weekOffBothSideAllowed: true,
      holidaySingleSideAllowed: true,
      holidayBothSideAllowed: true,
      status: true,
      nonClubbableWithFrom: {
        select: {
          blockedLeaveId: true,
        },
      },
      nonClubbableWithTo: {
        select: {
          leaveDefinitionId: true,
        },
      },
    },
  })
  if (!leaveDefinition || leaveDefinition.status !== "ACTIVE") {
    throw new BusinessError(400, "Selected leave definition is not active.")
  }

  if (
    leaveDefinition.allowedUsers !== "ALL" &&
    !staff.user.gender
  ) {
    throw new BusinessError(400, "User gender is required for this leave type.")
  }

  if (leaveDefinition.allowedUsers === "MALE" && staff.user.gender !== "MALE") {
    throw new BusinessError(400, "This leave type is only allowed for male staff.")
  }
  if (leaveDefinition.allowedUsers === "FEMALE" && staff.user.gender !== "FEMALE") {
    throw new BusinessError(400, "This leave type is only allowed for female staff.")
  }

  if (daysCount < leaveDefinition.minDaysPerRequest) {
    throw new BusinessError(400, "Requested days are below the minimum allowed per request.")
  }
  if (daysCount > leaveDefinition.maxDaysPerRequest) {
    throw new BusinessError(400, "Requested days exceed the maximum allowed per request.")
  }

  const today = getTodayDateOnlyUtc()
  if (!leaveDefinition.priorEntryAllowed && parsedStart < today) {
    throw new BusinessError(400, "Past leave entry is not allowed for this leave type.")
  }
  const minimumAllowedStart = addDays(today, leaveDefinition.noticeDays)
  if (parsedStart < minimumAllowedStart) {
    throw new BusinessError(400, `At least ${leaveDefinition.noticeDays} day(s) notice is required.`)
  }

  const pendingCount = await tx.leaveRequest.count({
    where: {
      tenantId,
      staffProfileId,
      leaveDefinitionId,
      status: "PENDING",
    },
  })
  if (pendingCount >= leaveDefinition.maxPendingRequests) {
    throw new BusinessError(400, "Maximum pending requests reached for this leave type.")
  }

  const overlappingRequests = await tx.leaveRequest.findMany({
    where: {
      tenantId,
      staffProfileId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: parsedEnd },
      endDate: { gte: parsedStart },
    },
    select: {
      id: true,
      leaveDefinitionId: true,
    },
  })

  if (!leaveDefinition.allowWithOtherLeaves && overlappingRequests.length > 0) {
    throw new BusinessError(400, "This leave cannot be combined with overlapping leave requests.")
  }

  const nonClubbableIds = new Set<string>([
    ...leaveDefinition.nonClubbableWithFrom.map((item) => item.blockedLeaveId),
    ...leaveDefinition.nonClubbableWithTo.map((item) => item.leaveDefinitionId),
  ])
  if (nonClubbableIds.size > 0) {
    const adjacentOrOverlapping = await tx.leaveRequest.findFirst({
      where: {
      tenantId,
        staffProfileId,
        status: { in: ["PENDING", "APPROVED"] },
        leaveDefinitionId: { in: Array.from(nonClubbableIds) },
        startDate: { lte: addDays(parsedEnd, 1) },
        endDate: { gte: addDays(parsedStart, -1) },
      },
      select: { id: true },
    })
    if (adjacentOrOverlapping) {
      throw new BusinessError(400, "This leave cannot be clubbed with the selected adjacent leave type.")
    }
  }

  const edgeDates = [addDays(parsedStart, -1), addDays(parsedEnd, 1)]
  const [beforeDate, afterDate] = edgeDates

  const [beforeSchedule, afterSchedule, holidayOverrides] = await Promise.all([
    getScheduleForDate(tx, staffProfileId, beforeDate, tenantId),
    getScheduleForDate(tx, staffProfileId, afterDate, tenantId),
    tx.appSettingOverride.findMany({
      where: {
        setting: { tenantId },
        date: { in: edgeDates },
        isOpen: false,
      },
      select: { date: true },
    }),
  ])

  const weekOffBefore = isWeekOffForSchedule(beforeDate, beforeSchedule)
  const weekOffAfter = isWeekOffForSchedule(afterDate, afterSchedule)
  if (weekOffBefore && weekOffAfter && !leaveDefinition.weekOffBothSideAllowed) {
    throw new BusinessError(400, "Week off is not allowed on both sides for this leave type.")
  }
  if (
    (weekOffBefore || weekOffAfter) &&
    !(weekOffBefore && weekOffAfter) &&
    !leaveDefinition.weekOffSingleSideAllowed
  ) {
    throw new BusinessError(400, "Week off is not allowed on a single side for this leave type.")
  }

  const holidaySet = new Set(holidayOverrides.map((item) => toIsoDate(item.date)))
  const holidayBefore = holidaySet.has(toIsoDate(beforeDate))
  const holidayAfter = holidaySet.has(toIsoDate(afterDate))
  if (holidayBefore && holidayAfter && !leaveDefinition.holidayBothSideAllowed) {
    throw new BusinessError(400, "Holiday is not allowed on both sides for this leave type.")
  }
  if (
    (holidayBefore || holidayAfter) &&
    !(holidayBefore && holidayAfter) &&
    !leaveDefinition.holidaySingleSideAllowed
  ) {
    throw new BusinessError(400, "Holiday is not allowed on a single side for this leave type.")
  }

  return {
    startDate: parsedStart,
    endDate: parsedEnd,
    daysCount,
  }
}

export const assertReviewTransitionAllowed = (
  currentStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED" | "REVOKED"
) => {
  if (currentStatus !== "PENDING") {
    throw new BusinessError(400, "Only pending leave requests can be reviewed.")
  }
}

export const assertCancelTransitionAllowed = (
  currentStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED" | "REVOKED"
) => {
  if (currentStatus !== "PENDING" && currentStatus !== "APPROVED") {
    throw new BusinessError(400, "Only pending or approved leave requests can be canceled.")
  }
}

export const assertRevokeTransitionAllowed = (
  currentStatus: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED" | "REVOKED"
) => {
  if (currentStatus !== "APPROVED") {
    throw new BusinessError(400, "Only approved leave requests can be revoked.")
  }
}

type LeaveApprovalConflictInput = {
  id: string
  staffProfileId: string
  startDate: Date
  endDate: Date
}

type LeaveApprovalConflict = {
  requestId: string
  conflictCount: number
  conflictingAppointments: Array<{
    id: string
    startAt: string
    endAt: string
    customerName: string | null
    serviceName: string | null
  }>
}

export const findLeaveApprovalConflicts = async (
  tx: DbClient,
  requests: LeaveApprovalConflictInput[],
  tenantId: string
): Promise<LeaveApprovalConflict[]> => {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const conflicts: LeaveApprovalConflict[] = []
  const settings = await tx.appSetting.findUnique({ where: { tenantId }, select: { timeZone: true } })
  const timeZone = settings?.timeZone ?? "UTC"
  const summaries = await appointmentConflictSummary(tx, tenantId, requests.map(request => ({
    staffProfileId: request.staffProfileId,
    startAt: startOfBusinessDate(request.startDate.toISOString().slice(0, 10), timeZone),
    endAt: startOfBusinessDate(addDaysUtc(request.endDate, 1).toISOString().slice(0, 10), timeZone),
  })))
  const canReadDetails = summaries.some(item => item.staffConflict) && await canReadAppointmentDetails(tenantId, databaseActorId(), tx)
  for (const [index, request] of requests.entries()) {
    const conflictCount = summaries[index].conflictCount
    if (conflictCount === 0) continue
    const rangeStart = startOfBusinessDate(request.startDate.toISOString().slice(0, 10), timeZone)
    const rangeEndExclusive = startOfBusinessDate(addDaysUtc(request.endDate, 1).toISOString().slice(0, 10), timeZone)
    const conflictingAppointments = canReadDetails ? await tx.appointment.findMany({
        where: {
          tenantId,
          staffProfileId: request.staffProfileId,
          status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
          startAt: { lt: rangeEndExclusive },
          endAt: { gt: rangeStart },
        },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          customer: { select: { name: true } },
          service: { select: { name: true } },
        },
        orderBy: { startAt: "asc" },
        take: 5,
      }) : []
    conflicts.push({
      requestId: request.id,
      conflictCount,
      conflictingAppointments: conflictingAppointments.map((item) => ({
        id: item.id,
        startAt: item.startAt.toISOString(),
        endAt: item.endAt.toISOString(),
        customerName: item.customer.name,
        serviceName: item.service.name,
      })),
    })
  }
  return conflicts
}

export const leaveRequestSelect = {
  officeId: true,
  id: true,
  staffProfileId: true,
  leaveDefinitionId: true,
  startDate: true,
  endDate: true,
  daysCount: true,
  reason: true,
  status: true,
  reviewedByUserId: true,
  reviewedAt: true,
  reviewerComment: true,
  canceledAt: true,
  cancelReason: true,
  revokedAt: true,
  revokedByUserId: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
  leaveDefinition: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  staffProfile: {
    select: {
      id: true,
      managerUserId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
  reviewedByUser: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  revokedByUser: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.LeaveRequestSelect

export const serializeLeaveRequest = (item: LeaveRequestWithRelations): LeaveRequestRow => ({
  id: item.id,
  officeId: item.officeId,
  staffProfileId: item.staffProfileId,
  leaveDefinitionId: item.leaveDefinitionId,
  startDate: item.startDate.toISOString(),
  endDate: item.endDate.toISOString(),
  daysCount: item.daysCount,
  reason: item.reason,
  status: item.status,
  reviewedByUserId: item.reviewedByUserId,
  reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
  reviewerComment: item.reviewerComment,
  canceledAt: item.canceledAt ? item.canceledAt.toISOString() : null,
  cancelReason: item.cancelReason,
  revokedAt: item.revokedAt ? item.revokedAt.toISOString() : null,
  revokedByUserId: item.revokedByUserId,
  revokeReason: item.revokeReason,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  leaveDefinition: item.leaveDefinition,
  staff: {
    id: item.staffProfile.id,
    userId: item.staffProfile.user.id,
    name: item.staffProfile.user.name,
    email: item.staffProfile.user.email,
  },
  reviewedBy: item.reviewedByUser
    ? {
        id: item.reviewedByUser.id,
        name: item.reviewedByUser.name,
        email: item.reviewedByUser.email,
      }
    : null,
  revokedBy: item.revokedByUser
    ? {
        id: item.revokedByUser.id,
        name: item.revokedByUser.name,
        email: item.revokedByUser.email,
      }
    : null,
})

type BuildLeaveRequestRuleChecksInput = {
  tx: DbClient
  tenantId: string
  staffProfileId: string
  staffGender: "MALE" | "FEMALE" | "NON_BINARY" | "OTHER" | "PREFER_NOT_TO_SAY" | null
  leaveDefinition: {
    allowedUsers: "MALE" | "FEMALE" | "ALL"
    minDaysPerRequest: number
    maxDaysPerRequest: number
    priorEntryAllowed: boolean
    noticeDays: number
    weekOffSingleSideAllowed: boolean
    weekOffBothSideAllowed: boolean
    holidaySingleSideAllowed: boolean
    holidayBothSideAllowed: boolean
  }
  startDate: Date
  endDate: Date
  createdAt: Date
}

const passFail = (passed: boolean): string => (passed ? "Pass" : "Fail")

export const buildLeaveRequestRuleChecks = async ({
  tx,
  tenantId,
  staffProfileId,
  staffGender,
  leaveDefinition,
  startDate,
  endDate,
  createdAt,
}: BuildLeaveRequestRuleChecksInput): Promise<LeaveRequestRuleCheck[]> => {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const checks: LeaveRequestRuleCheck[] = []
  const daysCount = getInclusiveDays(startDate, endDate)

  const allowedUsersPassed =
    leaveDefinition.allowedUsers === "ALL" ||
    (leaveDefinition.allowedUsers === "MALE" && staffGender === "MALE") ||
    (leaveDefinition.allowedUsers === "FEMALE" && staffGender === "FEMALE")
  checks.push({
    key: "allowedUsers",
    label: "Allowed users",
    passed: allowedUsersPassed,
    detail: `${passFail(allowedUsersPassed)} (${leaveDefinition.allowedUsers})`,
  })

  const minMaxPassed =
    daysCount >= leaveDefinition.minDaysPerRequest &&
    daysCount <= leaveDefinition.maxDaysPerRequest
  checks.push({
    key: "minMaxDays",
    label: "Min/Max days per request",
    passed: minMaxPassed,
    detail: `${passFail(minMaxPassed)} (${daysCount} day(s), allowed ${leaveDefinition.minDaysPerRequest}-${leaveDefinition.maxDaysPerRequest})`,
  })

  const createdDateOnly = new Date(
    Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate())
  )
  const priorEntryPassed = leaveDefinition.priorEntryAllowed || startDate >= createdDateOnly
  checks.push({
    key: "priorEntryAllowed",
    label: "Prior leave entry",
    passed: priorEntryPassed,
    detail: `${passFail(priorEntryPassed)} (${leaveDefinition.priorEntryAllowed ? "allowed" : "not allowed"})`,
  })

  const minStartByNotice = addDays(createdDateOnly, leaveDefinition.noticeDays)
  const noticePassed = startDate >= minStartByNotice
  checks.push({
    key: "noticeDays",
    label: "Notice days",
    passed: noticePassed,
    detail: `${passFail(noticePassed)} (${leaveDefinition.noticeDays} day(s) required)`,
  })

  const edgeDates = [addDays(startDate, -1), addDays(endDate, 1)]
  const [beforeDate, afterDate] = edgeDates
  const [beforeSchedule, afterSchedule, holidayOverrides] = await Promise.all([
    getScheduleForDate(tx, staffProfileId, beforeDate, tenantId),
    getScheduleForDate(tx, staffProfileId, afterDate, tenantId),
    tx.appSettingOverride.findMany({
      where: {
        setting: { tenantId },
        date: { in: edgeDates },
        isOpen: false,
      },
      select: { date: true },
    }),
  ])

  const weekOffBefore = isWeekOffForSchedule(beforeDate, beforeSchedule)
  const weekOffAfter = isWeekOffForSchedule(afterDate, afterSchedule)
  const weekOffPassed = !(
    (weekOffBefore && weekOffAfter && !leaveDefinition.weekOffBothSideAllowed) ||
    ((weekOffBefore || weekOffAfter) &&
      !(weekOffBefore && weekOffAfter) &&
      !leaveDefinition.weekOffSingleSideAllowed)
  )
  checks.push({
    key: "weekOffRules",
    label: "Week off side rules",
    passed: weekOffPassed,
    detail: `${passFail(weekOffPassed)} (single:${leaveDefinition.weekOffSingleSideAllowed ? "Y" : "N"}, both:${leaveDefinition.weekOffBothSideAllowed ? "Y" : "N"})`,
  })

  const holidaySet = new Set(holidayOverrides.map((item) => toIsoDate(item.date)))
  const holidayBefore = holidaySet.has(toIsoDate(beforeDate))
  const holidayAfter = holidaySet.has(toIsoDate(afterDate))
  const holidayPassed = !(
    (holidayBefore && holidayAfter && !leaveDefinition.holidayBothSideAllowed) ||
    ((holidayBefore || holidayAfter) &&
      !(holidayBefore && holidayAfter) &&
      !leaveDefinition.holidaySingleSideAllowed)
  )
  checks.push({
    key: "holidayRules",
    label: "Holiday side rules",
    passed: holidayPassed,
    detail: `${passFail(holidayPassed)} (single:${leaveDefinition.holidaySingleSideAllowed ? "Y" : "N"}, both:${leaveDefinition.holidayBothSideAllowed ? "Y" : "N"})`,
  })

  return checks
}

type BuildLeaveRequestTimelineInput = {
  createdAt: Date
  staffName: string | null
  staffEmail: string
  reviewedAt: Date | null
  reviewedByName: string | null
  reviewedByEmail: string | null
  reviewerComment: string | null
  canceledAt: Date | null
  cancelReason: string | null
  revokedAt: Date | null
  revokedByName: string | null
  revokedByEmail: string | null
  revokeReason: string | null
}

export const buildLeaveRequestTimeline = ({
  createdAt,
  staffName,
  staffEmail,
  reviewedAt,
  reviewedByName,
  reviewedByEmail,
  reviewerComment,
  canceledAt,
  cancelReason,
  revokedAt,
  revokedByName,
  revokedByEmail,
  revokeReason,
}: BuildLeaveRequestTimelineInput): LeaveRequestTimelineEvent[] => {
  const timeline: LeaveRequestTimelineEvent[] = [
    {
      key: "submitted",
      title: "Submitted",
      at: createdAt.toISOString(),
      byName: staffName,
      byEmail: staffEmail,
      comment: null,
    },
  ]

  if (reviewedAt) {
    timeline.push({
      key: "reviewed",
      title: "Reviewed",
      at: reviewedAt.toISOString(),
      byName: reviewedByName,
      byEmail: reviewedByEmail,
      comment: reviewerComment,
    })
  }

  if (canceledAt) {
    timeline.push({
      key: "canceled",
      title: "Canceled",
      at: canceledAt.toISOString(),
      byName: null,
      byEmail: null,
      comment: cancelReason,
    })
  }

  if (revokedAt) {
    timeline.push({
      key: "revoked",
      title: "Revoked",
      at: revokedAt.toISOString(),
      byName: revokedByName,
      byEmail: revokedByEmail,
      comment: revokeReason,
    })
  }

  return timeline
}
