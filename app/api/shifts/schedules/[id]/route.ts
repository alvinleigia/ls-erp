import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { toISODate } from "@/lib/date"
import { prisma } from "@/lib/prisma"
import { captureRosterHistoryUpToYesterday } from "@/lib/roster-history"
import { shiftScheduleSchema } from "@/lib/validation"
import { canManageUsers, type Role } from "@/lib/permissions"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed", scheduleId: id })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = shiftScheduleSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data
  const today = new Date().toISOString().slice(0, 10)
  if (data.startDate < today) {
    const response = NextResponse.json(
      { error: "Schedule start date cannot be in the past." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "past_schedule_start", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }
  if (data.assignmentStartDate && data.assignmentStartDate < today) {
    const response = NextResponse.json(
      { error: "Assignment start date cannot be in the past." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "past_assignment_start", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }
  const weekOff2Weeks =
    data.weekOffDay2 && (!data.weekOff2Weeks || !data.weekOff2Weeks.length)
      ? [1, 2, 3, 4, 5]
      : data.weekOff2Weeks ?? []
  const templateIds = [...new Set(data.blocks.map((block) => block.templateId))]
  if (templateIds.length) {
    const templateCount = await prisma.shiftTemplate.count({
      where: { tenantId, id: { in: templateIds } },
    })
    if (templateCount !== templateIds.length) {
      const response = NextResponse.json(
        { error: "One or more shift templates were not found in this tenant." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "invalid_template_ids", scheduleId: id })
      return withRequestId(response, logContext.requestId)
    }
  }
  let schedule: { id: string } | null = null
  const currentSchedule = await prisma.shiftSchedule.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      isDefault: true,
      startDate: true,
      assignments: {
        select: {
          staffProfileId: true,
          startDate: true,
        },
      },
    },
  })

  if (currentSchedule) {
    if (currentSchedule.isDefault) {
      const allStaffProfiles = await prisma.staffProfile.findMany({
        where: { user: { tenantId } },
        select: { id: true },
      })
      if (allStaffProfiles.length) {
        await captureRosterHistoryUpToYesterday(prisma, {
          staffProfileIds: allStaffProfiles.map((item) => item.id),
          startDate: toISODate(currentSchedule.startDate),
          tenantId,
        })
      }
    } else if (currentSchedule.assignments.length) {
      const staffProfileIds = Array.from(
        new Set(currentSchedule.assignments.map((assignment) => assignment.staffProfileId))
      )
      const earliest = currentSchedule.assignments
        .map((assignment) => toISODate(assignment.startDate))
        .sort()[0]
      await captureRosterHistoryUpToYesterday(prisma, {
        staffProfileIds,
        startDate: earliest,
        tenantId,
      })
    }
  }

  if (data.isDefault) {
    await prisma.shiftSchedule.updateMany({ where: { tenantId }, data: { isDefault: false } })
    schedule = await prisma.$transaction(async (tx) => {
      const updated = await tx.shiftSchedule.updateMany({
        where: { id, tenantId },
        data: {
          name: data.name?.trim() || null,
          isDefault: true,
          startDate: new Date(data.startDate),
          weekOffDay1: data.weekOffDay1,
          weekOffDay2: data.weekOffDay2 ? data.weekOffDay2 : null,
          weekOff2Weeks,
        },
      })
      if (!updated.count) return null

      await tx.shiftScheduleBlock.deleteMany({ where: { scheduleId: id, schedule: { tenantId } } })
      if (data.blocks.length) {
        await tx.shiftScheduleBlock.createMany({
          data: data.blocks.map((block, index) => ({
            scheduleId: id,
            templateId: block.templateId,
            repeatDays: block.repeatDays,
            sortOrder: block.sortOrder ?? index,
          })),
        })
      }

      await tx.staffScheduleAssignment.deleteMany({ where: { scheduleId: id, schedule: { tenantId } } })

      return { id }
    })
  } else {
    const staffIds = Array.from(new Set(data.staffIds.map((value) => value.trim())))
    if (!staffIds.length) {
      const response = NextResponse.json(
        { error: "Select at least one staff member." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "missing_staff_ids", scheduleId: id })
      return withRequestId(response, logContext.requestId)
    }

    const staffProfiles = await prisma.staffProfile.findMany({
      where: { userId: { in: staffIds }, user: { tenantId }, schedulingMode: "STANDARD" },
      select: { id: true, userId: true },
    })

    const staffProfilesMap = new Map(staffProfiles.map((profile) => [profile.userId, profile]))
    const missingStaffIds = staffIds.filter((staffId) => !staffProfilesMap.has(staffId))

    if (missingStaffIds.length) {
      const staffUsers = await prisma.user.findMany({
        where: { id: { in: missingStaffIds }, role: "STAFF", tenantId },
        select: { id: true, staffProfile: { select: { schedulingMode: true } } },
      })
      const flexibleStaffIds = staffUsers
        .filter((user) => user.staffProfile?.schedulingMode === "FLEXIBLE")
        .map((user) => user.id)
      if (flexibleStaffIds.length) {
        const response = NextResponse.json(
          { error: "Flexible-mode staff cannot be assigned to shift schedules." },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "flexible_staff_not_allowed", scheduleId: id })
        return withRequestId(response, logContext.requestId)
      }
      if (staffUsers.length) {
        const createdProfiles = await Promise.all(
          staffUsers
            .filter((user) => !user.staffProfile)
            .map((user) =>
            prisma.staffProfile.create({
              data: { userId: user.id },
              select: { id: true, userId: true },
            })
            )
        )
        for (const profile of createdProfiles) {
          staffProfilesMap.set(profile.userId, profile)
        }
      }
    }

    const finalStaffProfiles = staffIds
      .map((staffId) => staffProfilesMap.get(staffId))
      .filter(Boolean) as { id: string; userId: string }[]

    if (!finalStaffProfiles.length) {
      const response = NextResponse.json({ error: "Staff profile not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "staff_profile_not_found", scheduleId: id })
      return withRequestId(response, logContext.requestId)
    }

    const assignmentStart = data.assignmentStartDate
      ? new Date(data.assignmentStartDate)
      : new Date(data.startDate)
    const assignmentEnd = data.assignmentEndDate ? new Date(data.assignmentEndDate) : null

    const existingAssignments = await prisma.staffScheduleAssignment.findMany({
      where: {
        staffProfileId: { in: finalStaffProfiles.map((profile) => profile.id) },
        scheduleId: { not: id },
        schedule: { tenantId },
        ...(assignmentEnd ? { startDate: { lte: assignmentEnd } } : {}),
        OR: [{ endDate: null }, { endDate: { gte: assignmentStart } }],
      },
      select: { staffProfileId: true },
    })

    if (existingAssignments.length) {
      const response = NextResponse.json(
        { error: "Selected staff already have schedules assigned in this range." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "assignment_conflict", scheduleId: id })
      return withRequestId(response, logContext.requestId)
    }

    schedule = await prisma.$transaction(async (tx) => {
      const updated = await tx.shiftSchedule.updateMany({
        where: { id, tenantId },
        data: {
          name: data.name?.trim() || null,
          isDefault: false,
          startDate: new Date(data.startDate),
          weekOffDay1: data.weekOffDay1,
          weekOffDay2: data.weekOffDay2 ? data.weekOffDay2 : null,
          weekOff2Weeks,
        },
      })
      if (!updated.count) return null

      await tx.shiftScheduleBlock.deleteMany({ where: { scheduleId: id, schedule: { tenantId } } })
      if (data.blocks.length) {
        await tx.shiftScheduleBlock.createMany({
          data: data.blocks.map((block, index) => ({
            scheduleId: id,
            templateId: block.templateId,
            repeatDays: block.repeatDays,
            sortOrder: block.sortOrder ?? index,
          })),
        })
      }

      await tx.staffScheduleAssignment.deleteMany({ where: { scheduleId: id, schedule: { tenantId } } })
      await tx.staffScheduleAssignment.createMany({
        data: finalStaffProfiles.map((profile) => ({
          staffProfileId: profile.id,
          scheduleId: id,
          startDate: assignmentStart,
          endDate: assignmentEnd,
        })),
      })

      return { id }
    })
  }
  if (!schedule) {
    const response = NextResponse.json({ error: "Schedule not found." }, { status: 404 })
    logApiRequestSuccess(logContext, 404, { reason: "not_found", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }

  const withBlocks = await prisma.shiftSchedule.findFirst({
    where: { id: schedule.id, tenantId },
    include: {
      blocks: {
        orderBy: { sortOrder: "asc" },
        include: { template: { select: { id: true, name: true } } },
      },
      assignments: {
        include: { staffProfile: { select: { user: { select: { id: true, name: true, email: true } } } } },
      },
    },
  })

  const response = NextResponse.json({ schedule: withBlocks })
  logApiRequestSuccess(logContext, 200, { scheduleId: id })
  return withRequestId(response, logContext.requestId)
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed", scheduleId: id })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized", scheduleId: id })
    return withRequestId(response, logContext.requestId)
  }

  const currentSchedule = await prisma.shiftSchedule.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      isDefault: true,
      startDate: true,
      assignments: {
        select: {
          staffProfileId: true,
          startDate: true,
        },
      },
    },
  })

  if (currentSchedule) {
    if (currentSchedule.isDefault) {
      const allStaffProfiles = await prisma.staffProfile.findMany({
        where: { user: { tenantId } },
        select: { id: true },
      })
      if (allStaffProfiles.length) {
        await captureRosterHistoryUpToYesterday(prisma, {
          staffProfileIds: allStaffProfiles.map((item) => item.id),
          startDate: toISODate(currentSchedule.startDate),
          tenantId,
        })
      }
    } else if (currentSchedule.assignments.length) {
      const staffProfileIds = Array.from(
        new Set(currentSchedule.assignments.map((assignment) => assignment.staffProfileId))
      )
      const earliest = currentSchedule.assignments
        .map((assignment) => toISODate(assignment.startDate))
        .sort()[0]
      await captureRosterHistoryUpToYesterday(prisma, {
        staffProfileIds,
        startDate: earliest,
        tenantId,
      })
    }
  }

  try {
    const deleted = await prisma.shiftSchedule.deleteMany({ where: { id, tenantId } })
    if (!deleted.count) {
      const response = NextResponse.json({ error: "Schedule not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", scheduleId: id })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { scheduleId: id, result: "deleted" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { scheduleId: id })
    const response = NextResponse.json({ error: "Unable to delete schedule." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "archive", actor => handleDELETE(request, context, actor), "schedules/[id]", (await context.params).id)
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "edit", actor => handlePATCH(request, context, actor), "schedules/[id]", (await context.params).id)
}
