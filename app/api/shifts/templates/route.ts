import { BusinessError } from "@/platform/policy"
import { shiftTemplateListSchema, listShiftTemplates, createShiftTemplate } from "@/modules/workforce/shift-templates"
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

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const parsed = shiftTemplateListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()))
    if (!parsed.success) {
      throw new BusinessError(400, "Invalid pagination or filter parameters.")
    }
    const response = await listShiftTemplates(tenantId, parsed.data)
    const { page, pageSize: effectivePageSize, total } = response
    const json = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize: effectivePageSize, total })
    return withRequestId(json, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load shift templates." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)


  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = shiftTemplateSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const template = await createShiftTemplate(actor, parsed.data)

    const response = NextResponse.json({ template })
    logApiRequestSuccess(logContext, 200, { templateId: template.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create shift template." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftTemplates", "create", actor => handlePOST(request, actor), "templates")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftTemplates", "read", actor => handleGET(request, actor), "templates")
}
