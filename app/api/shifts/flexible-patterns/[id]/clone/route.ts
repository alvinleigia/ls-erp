import { requirePermission } from "@/platform/access/policy"
import { BusinessError } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"

const cloneSchema = z.object({
  name: z.string().trim().max(120).optional().or(z.literal("")),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  activate: z.boolean().optional().default(true),
  targetStaffId: z.string().trim().min(1).optional(),
})

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10)

const rangesOverlap = (aStart: string, aEnd: string | null, bStart: string, bEnd: string | null) => {
  const leftStart = new Date(`${aStart}T00:00:00.000Z`).getTime()
  const leftEnd = aEnd ? new Date(`${aEnd}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY
  const rightStart = new Date(`${bStart}T00:00:00.000Z`).getTime()
  const rightEnd = bEnd ? new Date(`${bEnd}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY
  return leftStart <= rightEnd && rightStart <= leftEnd
}

async function handlePOST(
  request: Request,
  context: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const payload = await request.json().catch(() => null)
  const parsed = cloneSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data
  if (data.validTo && data.validFrom > data.validTo) {
    const response = NextResponse.json({ error: "validFrom must be on or before validTo." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_date_range" })
    return withRequestId(response, logContext.requestId)
  }

  const { id } = await context.params
  try {
    const source = await prisma.staffFlexiblePattern.findFirst({
      where: {
        id,
        staffProfile: {
          user: {
            tenantId,
            role: "STAFF",
          },
        },
      },
      include: {
        staffProfile: {
          select: {
            id: true,
            userId: true,
          },
        },
        weeks: {
          include: {
            days: {
              include: {
                slots: {
                  include: {
                    breaks: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!source) {
      const response = NextResponse.json({ error: "Recurring pattern not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const targetStaffProfile =
      data.targetStaffId && data.targetStaffId !== source.staffProfile.userId
        ? await prisma.staffProfile.findFirst({
            where: {
              userId: data.targetStaffId,
              user: {
                tenantId,
                role: "STAFF",
              },
            },
            select: { id: true, schedulingMode: true },
          })
        : null

    if (data.targetStaffId && data.targetStaffId !== source.staffProfile.userId) {
      if (!targetStaffProfile) {
        const response = NextResponse.json({ error: "Target staff profile not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "target_staff_not_found" })
        return withRequestId(response, logContext.requestId)
      }
      if (targetStaffProfile.schedulingMode !== "FLEXIBLE") {
        const response = NextResponse.json(
          { error: "Target staff must be in Flexible scheduling mode before assignment." },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "target_staff_not_flexible" })
        return withRequestId(response, logContext.requestId)
      }
    }

    const targetStaffProfileId = targetStaffProfile?.id ?? source.staffProfileId

    const clone = await prisma.$transaction(async (tx) => {
      if (data.activate) {
        const activePatterns = await tx.staffFlexiblePattern.findMany({
          where: {
            staffProfileId: targetStaffProfileId,
            isActive: true,
            id: { not: source.id },
          },
          select: { id: true, validFrom: true, validTo: true },
        })
        const overlappingIds = activePatterns
          .filter((existing) =>
            rangesOverlap(
              toDateOnly(existing.validFrom),
              existing.validTo ? toDateOnly(existing.validTo) : null,
              data.validFrom,
              data.validTo || null
            )
          )
          .map((existing) => existing.id)
        if (overlappingIds.length) {
          requirePermission(actor, "shiftPlans.archive")
          await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "workforce.shiftPlans.archive", entityType: "shiftPlans", before: { activePatternIds: overlappingIds }, after: { inactivePatternIds: overlappingIds } })
          await tx.staffFlexiblePattern.updateMany({
            where: { id: { in: overlappingIds } },
            data: { isActive: false },
          })
        }
      }

      const created = await tx.staffFlexiblePattern.create({
        data: {
          staffProfileId: targetStaffProfileId,
          name: data.name?.trim() || source.name || null,
          cycleLengthWeeks: source.cycleLengthWeeks,
          validFrom: new Date(`${data.validFrom}T00:00:00.000Z`),
          validTo: data.validTo ? new Date(`${data.validTo}T00:00:00.000Z`) : null,
          isActive: data.activate,
        },
      })

      for (const sourceWeek of source.weeks.sort((a, b) => a.weekIndex - b.weekIndex)) {
        const createdWeek = await tx.staffFlexiblePatternWeek.create({
          data: {
            patternId: created.id,
            weekIndex: sourceWeek.weekIndex,
          },
          select: { id: true },
        })

        for (const sourceDay of sourceWeek.days.sort((a, b) => a.sortOrder - b.sortOrder)) {
          const createdDay = await tx.staffFlexiblePatternDay.create({
            data: {
              weekId: createdWeek.id,
              day: sourceDay.day,
              isOff: sourceDay.isOff,
              sortOrder: sourceDay.sortOrder,
            },
            select: { id: true },
          })

          for (const sourceSlot of sourceDay.slots.sort((a, b) => a.sortOrder - b.sortOrder)) {
            const createdSlot = await tx.staffFlexiblePatternSlot.create({
              data: {
                dayId: createdDay.id,
                startTime: sourceSlot.startTime,
                endTime: sourceSlot.endTime,
                sortOrder: sourceSlot.sortOrder,
              },
              select: { id: true },
            })

            if (!sourceSlot.breaks.length) continue

            await tx.staffFlexiblePatternBreak.createMany({
              data: sourceSlot.breaks
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((sourceBreak) => ({
                  slotId: createdSlot.id,
                  startTime: sourceBreak.startTime,
                  endTime: sourceBreak.endTime,
                  sortOrder: sourceBreak.sortOrder,
                })),
            })
          }
        }
      }

      return created
    })

    const response = NextResponse.json({ id: clone.id })
    logApiRequestSuccess(logContext, 200, {
      sourcePatternId: id,
      clonePatternId: clone.id,
      targetStaffProfileId,
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to clone recurring pattern." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "create", actor => handlePOST(request, context, actor), "flexible-patterns/[id]/clone", (await context.params).id)
}
