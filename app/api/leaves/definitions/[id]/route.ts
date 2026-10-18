import { BusinessError } from "@/platform/policy"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { withWorkforceApi } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import { updateLeaveDefinitionSchema } from "@/lib/validation"
import {
  getLeaveDefinition,
  updateLeaveDefinition,
  deleteLeaveDefinition,
  serializeLeaveDefinition,
} from "@/modules/workforce/leave-definitions"

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const { id } = await params
    const item = await getLeaveDefinition(tenantId, id)
    const response = NextResponse.json({ item: serializeLeaveDefinition(item) })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave definition." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const { id } = await params
    const payload = await request.json().catch(() => ({}))
    const parsed = updateLeaveDefinitionSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const item = await updateLeaveDefinition(tenantId, id, parsed.data)
    const response = NextResponse.json({ item: serializeLeaveDefinition(item) })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update leave definition." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const { id } = await params
    await deleteLeaveDefinition(tenantId, id)
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete leave definition." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "archive", actor => handleDELETE(request, context, actor), "definitions/[id]", (await context.params).id)
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "edit", actor => handlePATCH(request, context, actor), "definitions/[id]", (await context.params).id)
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "read", actor => handleGET(request, context, actor), "definitions/[id]", (await context.params).id)
}
