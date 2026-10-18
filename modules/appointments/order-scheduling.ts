import { AppointmentStatus } from "@prisma/client"

import { checkStaffAppointmentAvailability } from "@/modules/workforce/availability"
import { prisma } from "@/lib/prisma"
import type { ResolvedOrderLine } from "@/modules/appointments/order-resolution"

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
]

export class AvailabilityConflictError extends Error {
  suggestedStartAt?: string

  constructor(message: string, suggestedStartAt?: Date) {
    super(message)
    this.name = "AvailabilityConflictError"
    this.suggestedStartAt = suggestedStartAt?.toISOString()
  }
}

const SUGGESTION_STEP_MINUTES = 15
const SUGGESTION_MAX_STEPS = 14 * 24 * (60 / SUGGESTION_STEP_MINUTES)

const getLineConflictReason = async (
  line: { staffProfileId: string; startAt: Date; endAt: Date },
  customerId: string,
  excludedAppointmentIds: string[],
  tenantId: string
) => {
  const availability = await checkStaffAppointmentAvailability(
    line.staffProfileId,
    line.startAt,
    line.endAt,
    tenantId
  )
  if (!availability.ok) {
    return availability.reason || "Staff is unavailable for one of the selected slots."
  }

  const [staffConflict, customerConflict] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        tenantId,
        id: excludedAppointmentIds.length ? { notIn: excludedAppointmentIds } : undefined,
        staffProfileId: line.staffProfileId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        startAt: { lt: line.endAt },
        endAt: { gt: line.startAt },
      },
      select: { id: true },
    }),
    prisma.appointment.findFirst({
      where: {
        tenantId,
        id: excludedAppointmentIds.length ? { notIn: excludedAppointmentIds } : undefined,
        customerId,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        startAt: { lt: line.endAt },
        endAt: { gt: line.startAt },
      },
      select: { id: true },
    }),
  ])

  if (staffConflict) {
    return "A staff member has a conflicting appointment."
  }
  if (customerConflict) {
    return "Customer has a conflicting appointment."
  }
  return null
}

const alignToStep = (value: Date) => {
  const next = new Date(value)
  next.setSeconds(0, 0)
  const remainder = next.getMinutes() % SUGGESTION_STEP_MINUTES
  if (remainder !== 0) {
    next.setMinutes(next.getMinutes() + (SUGGESTION_STEP_MINUTES - remainder))
  }
  return next
}

const findNextAvailableLineStart = async (
  line: ResolvedOrderLine,
  customerId: string,
  excludedAppointmentIds: string[],
  earliestStart: Date,
  tenantId: string
) => {
  let candidate = alignToStep(earliestStart)

  for (let step = 0; step < SUGGESTION_MAX_STEPS; step += 1) {
    const startAt = new Date(candidate)
    const endAt = new Date(candidate.getTime() + line.durationMinutes * 60000)
    const reason = await getLineConflictReason(
      {
        staffProfileId: line.staffProfileId,
        startAt,
        endAt,
      },
      customerId,
      excludedAppointmentIds,
      tenantId
    )
    if (!reason) return { startAt, endAt }
    candidate = new Date(candidate.getTime() + SUGGESTION_STEP_MINUTES * 60_000)
  }

  return null
}

export const scheduleConfirmedOrderLines = async (
  orderLines: ResolvedOrderLine[],
  customerId: string,
  excludedAppointmentIds: string[] = [],
  tenantId: string
) => {
  const scheduledLines: ResolvedOrderLine[] = []
  let cursor = orderLines[0]?.startAt ? new Date(orderLines[0].startAt) : new Date()

  for (let index = 0; index < orderLines.length; index += 1) {
    const line = orderLines[index]
    const lineStart = index === 0 ? new Date(line.startAt) : cursor
    const lineEnd = new Date(lineStart.getTime() + line.durationMinutes * 60000)

    if (index === 0) {
      const reason = await getLineConflictReason(
        {
          staffProfileId: line.staffProfileId,
          startAt: lineStart,
          endAt: lineEnd,
        },
        customerId,
        excludedAppointmentIds,
        tenantId
      )
      if (reason) {
        const suggestion = await findNextAvailableLineStart(
          line,
          customerId,
          excludedAppointmentIds,
          new Date(lineStart.getTime() + SUGGESTION_STEP_MINUTES * 60_000),
          tenantId
        )
        throw new AvailabilityConflictError(reason, suggestion?.startAt)
      }
      scheduledLines.push({ ...line, startAt: lineStart, endAt: lineEnd })
      cursor = lineEnd
      continue
    }

    const nextSlot = await findNextAvailableLineStart(
      line,
      customerId,
      excludedAppointmentIds,
      lineStart,
      tenantId
    )
    if (!nextSlot) {
      throw new AvailabilityConflictError(
        `Unable to find an available slot for service item ${index + 1}.`
      )
    }

    scheduledLines.push({
      ...line,
      startAt: nextSlot.startAt,
      endAt: nextSlot.endAt,
    })
    cursor = nextSlot.endAt
  }

  return scheduledLines
}
