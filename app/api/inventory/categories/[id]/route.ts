import { BusinessError } from "@/platform/policy"
import { updateInventoryCategory, archiveInventoryCategory } from "@/modules/inventory/category-service"
import { withInventoryApi } from "@/modules/inventory/api"
import type { BusinessActor } from "@/platform/policy"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { updateInventoryCategorySchema } from "@/lib/validation"


async function handlePATCH(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  try {
    const { id } = await params
    const body = await request.json()
    const parsed = updateInventoryCategorySchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const updatedItem = await updateInventoryCategory(actor, id, parsed.data)

    const response = NextResponse.json({
      item: {
        ...updatedItem,
        createdAt: updatedItem.createdAt.toISOString(),
      },
    })
    logApiRequestSuccess(logContext, 200, { itemId: updatedItem.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update category." }, { status: 500 })
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
    const { linkedProducts } = await archiveInventoryCategory(actor, id)

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { itemId: id, linkedProducts })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete category." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventoryCategories", "edit", actor => handlePATCH(request, actor, context), id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventoryCategories", "archive", actor => handleDELETE(request, actor, context), id)
}
