import { BusinessError } from "@/platform/policy"
import { serviceListSchema, listServices, createService } from "@/modules/services/catalog-service"
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
import {
  createServiceSchema,
} from "@/lib/validation"

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  const url = new URL(request.url)
  const parsed = serviceListSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid pagination parameters." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { items, page, pageSize, total, totalPages } = await listServices(tenantId, parsed.data)

    const response = NextResponse.json({
      items: items.map((item) => ({
        ...item,
      taxIds: item.defaultTaxes.map((tax) => tax.taxId),
    })),
      page,
      pageSize,
      total,
      totalPages,
    })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load services." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = createServiceSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const item = await createService(tenantId, parsed.data)

    const response = NextResponse.json({
      item: {
        ...item,
        taxIds: item.defaultTaxes.map((tax) => tax.taxId),
      },
    })
    logApiRequestSuccess(logContext, 200, { serviceId: item.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create service." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export function GET(request: Request) { return withServicesApi(request, "services", "read", actor => handleGET(request, actor)) }

export function POST(request: Request) { return withServicesApi(request, "services", "create", actor => handlePOST(request, actor)) }
