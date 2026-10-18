import { BusinessError } from "@/platform/policy"
import { updateShiftTemplate, deleteShiftTemplate } from "@/modules/workforce/shift-templates"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { shiftTemplateSchema } from "@/lib/validation"
import { withWorkforceApi } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params

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
    const withBreaks = await updateShiftTemplate(actor, id, parsed.data)

    const response = NextResponse.json({ template: withBreaks })
    logApiRequestSuccess(logContext, 200, { templateId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
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

  try {
    await deleteShiftTemplate(actor, id)
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { templateId: id, result: "deleted" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
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
