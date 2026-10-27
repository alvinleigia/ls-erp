import { updatePurchase, serializePurchaseOrder, getPurchase } from "@/modules/inventory/purchase-service"
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
import { updatePurchaseOrderSchema } from "@/lib/validation"



async function handlePATCH(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  try {
    const { id } = await params
    const body = await request.json()
    const parsed = updatePurchaseOrderSchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const updated = await updatePurchase(actor, id, parsed.data)
    const response = NextResponse.json({ item: serializePurchaseOrder(updated) })
    logApiRequestSuccess(logContext, 200, { orderId: id, status: updated.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof BusinessError) throw error
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update purchase order." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventoryPurchases", "edit", actor => handlePATCH(request, actor, context), id)
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request,"inventoryPurchases","read",async actor=>NextResponse.json({item:serializePurchaseOrder(await getPurchase(actor,id))}),id)
}
