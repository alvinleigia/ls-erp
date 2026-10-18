import { BusinessError } from "@/platform/policy"
import { updateService, archiveService } from "@/modules/services/catalog-service"
import { withServicesApi } from "@/modules/services/api"
import type { BusinessActor } from "@/platform/policy"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { updateServiceSchema } from "@/lib/validation"

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: BusinessActor
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const { tenantId } = actor

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", serviceId: id })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = updateServiceSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", serviceId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const item = await updateService(tenantId, id, parsed.data)

    const response = NextResponse.json({
      item: item
        ? {
            ...item,
            taxIds: item.defaultTaxes.map((tax) => tax.taxId),
          }
        : null,
    })
    logApiRequestSuccess(logContext, 200, { serviceId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500, { serviceId: id })
    const response = NextResponse.json({ error: "Unable to update service." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: BusinessActor
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const { tenantId } = actor

  try {
    const { associations } = await archiveService(tenantId, id)

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, {
      serviceId: id,
      result: associations > 0 ? "soft_deleted" : "hard_deleted",
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500, { serviceId: id })
    const response = NextResponse.json({ error: "Unable to delete service." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withServicesApi(request, "services", "edit", actor => handlePATCH(request, context, actor), id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withServicesApi(request, "services", "archive", actor => handleDELETE(request, context, actor), id)
}
