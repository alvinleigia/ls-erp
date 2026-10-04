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

const updateAssignmentSchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10)

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, {
      reason: "tenant_or_auth_failed",
      assignmentId: id,
    })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized", assignmentId: id })
    return withRequestId(response, logContext.requestId)
  }

  const payload = await request.json().catch(() => null)
  const parsed = updateAssignmentSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", assignmentId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const assignment = await prisma.staffScheduleAssignment.findFirst({
      where: {
        id,
        schedule: { tenantId },
      },
      select: { id: true, startDate: true, endDate: true },
    })
    if (!assignment) {
      const response = NextResponse.json({ error: "Assignment not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", assignmentId: id })
      return withRequestId(response, logContext.requestId)
    }

    const startDateOnly = toDateOnly(assignment.startDate)
    if (parsed.data.endDate < startDateOnly) {
      const response = NextResponse.json(
        { error: "End date cannot be before assignment start date." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, {
        reason: "invalid_end_before_start",
        assignmentId: id,
      })
      return withRequestId(response, logContext.requestId)
    }

    const updated = await prisma.staffScheduleAssignment.update({
      where: { id: assignment.id },
      data: { endDate: new Date(`${parsed.data.endDate}T00:00:00.000Z`) },
      select: { id: true, startDate: true, endDate: true },
    })

    const response = NextResponse.json({
      item: {
        id: updated.id,
        startDate: toDateOnly(updated.startDate),
        endDate: updated.endDate ? toDateOnly(updated.endDate) : null,
      },
    })
    logApiRequestSuccess(logContext, 200, { assignmentId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { assignmentId: id })
    const response = NextResponse.json({ error: "Unable to update assignment." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}


export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftSchedules", "archive", actor => handlePATCH(request, context, actor), "assignments/[id]", (await context.params).id)
}
