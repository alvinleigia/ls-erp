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
import {
  createLeaveDefinitionSchema,
} from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { LeaveDefinitionRow } from "@/types/leaves"
import {
  leaveDefinitionListSchema,
  listLeaveDefinitions,
  createLeaveDefinition,
  serializeLeaveDefinition,
} from "@/modules/workforce/leave-definitions"

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const parsed = leaveDefinitionListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    )
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid query parameters.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const { items, page, pageSize, total } = await listLeaveDefinitions(tenantId, parsed.data)

    const response: ListResponse<LeaveDefinitionRow> = {
      items: items.map(serializeLeaveDefinition),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
    const jsonResponse = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(jsonResponse, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave definitions." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  try {
    const payload = await request.json().catch(() => ({}))
    const parsed = createLeaveDefinitionSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const item = await createLeaveDefinition(tenantId, parsed.data)
    const response = NextResponse.json({ item: serializeLeaveDefinition(item) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { itemId: item.id, code: item.code })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create leave definition." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "create", actor => handlePOST(request, actor), "definitions")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "read", actor => handleGET(request, actor), "definitions")
}
