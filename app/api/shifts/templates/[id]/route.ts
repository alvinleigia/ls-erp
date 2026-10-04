import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import { shiftTemplateSchema } from "@/lib/validation"
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
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed", templateId: id })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized", templateId: id })
    return withRequestId(response, logContext.requestId)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", templateId: id })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = shiftTemplateSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", templateId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const data = parsed.data
    const template = await prisma.$transaction(async (tx) => {
      const updated = await tx.shiftTemplate.updateMany({
        where: { id, tenantId },
        data: {
          name: data.name,
          description: data.description || null,
          color: data.color || null,
          isActive: data.isActive ?? true,
          startTime: data.startTime,
          endTime: data.endTime,
        },
      })
      if (!updated.count) {
        return null
      }
      await tx.shiftTemplateBreak.deleteMany({ where: { templateId: id, template: { tenantId } } })
      if (data.breaks.length) {
        await tx.shiftTemplateBreak.createMany({
          data: data.breaks.map((period, index) => ({
            templateId: id,
            startTime: period.startTime,
            endTime: period.endTime,
            sortOrder: period.sortOrder ?? index,
          })),
        })
      }
      return { id }
    })
    if (!template) {
      const response = NextResponse.json({ error: "Shift template not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", templateId: id })
      return withRequestId(response, logContext.requestId)
    }

    const withBreaks = await prisma.shiftTemplate.findFirst({
      where: { id: template.id, tenantId },
      include: { breaks: { orderBy: { sortOrder: "asc" } } },
    })

    const response = NextResponse.json({ template: withBreaks })
    logApiRequestSuccess(logContext, 200, { templateId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { templateId: id })
    const response = NextResponse.json({ error: "Unable to update shift template." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed", templateId: id })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized", templateId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const [scheduleBlocks, overrides] = await Promise.all([
      prisma.shiftScheduleBlock.count({ where: { templateId: id, schedule: { tenantId } } }),
      prisma.staffShiftOverride.count({ where: { templateId: id, staffProfile: { user: { tenantId } } } }),
    ])
    if (scheduleBlocks > 0 || overrides > 0) {
      const response = NextResponse.json(
        { error: "Template is in use and cannot be deleted." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "template_in_use", templateId: id })
      return withRequestId(response, logContext.requestId)
    }

    const deleted = await prisma.shiftTemplate.deleteMany({ where: { id, tenantId } })
    if (!deleted.count) {
      const response = NextResponse.json({ error: "Shift template not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", templateId: id })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { templateId: id, result: "deleted" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { templateId: id })
    const response = NextResponse.json({ error: "Unable to delete shift template." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftTemplates", "archive", actor => handleDELETE(request, context, actor), "templates/[id]", (await context.params).id)
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "shifts", "shiftTemplates", "edit", actor => handlePATCH(request, context, actor), "templates/[id]", (await context.params).id)
}
