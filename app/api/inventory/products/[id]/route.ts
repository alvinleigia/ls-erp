import { updateProduct, archiveProduct, getProduct } from "@/modules/inventory/product-service"
import { withInventoryApi } from "@/modules/inventory/api"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { updateInventoryProductSchema } from "@/lib/validation"


async function handlePATCH(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  try {
    const { id } = await params
    const body = await request.json()
    const parsed = updateInventoryProductSchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const item = await updateProduct(actor, id, parsed.data)

    const response = NextResponse.json({ item })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update product." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  try {
    const { id } = await params
    const { linkedPurchases, hasStockMovements } = await archiveProduct(actor, id)

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { itemId: id, linkedPurchases, hasStockMovements })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete product." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventoryProducts", "edit", actor => handlePATCH(request, actor, context), id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventoryProducts", "archive", actor => handleDELETE(request, actor, context), id)
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request,"inventoryProducts","read",async actor=>NextResponse.json({item:await getProduct(actor,id,new URL(request.url).searchParams.get("officeId") ?? undefined)}),id)
}
