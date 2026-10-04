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
import { prisma } from "@/lib/prisma"
import { updatePurchaseOrderSchema } from "@/lib/validation"


const toDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`)

async function handlePATCH(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)
  const { tenantId } = actor

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

    const data = parsed.data
    const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        orderNumber: true,
        status: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            receivedQty: true,
            unitCostCents: true,
          },
        },
      },
    })

    if (!existing || existing.tenantId !== tenantId) {
      throw new Error("NOT_FOUND")
    }

    const nextStatus = data.status ?? existing.status
    const shouldReceive = existing.status !== "RECEIVED" && nextStatus === "RECEIVED"

    const order = await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.expectedDate !== undefined
          ? { expectedDate: data.expectedDate ? toDateOnly(data.expectedDate) : null }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        ...(shouldReceive ? { receivedAt: new Date() } : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderDate: true,
        expectedDate: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true,
        createdAt: true,
          notes: true,
        supplier: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            receivedQty: true,
            unitCostCents: true,
            taxPercent: true,
            lineSubtotalCents: true,
            lineTaxCents: true,
            lineTotalCents: true,
            productId: true,
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    })

    if (shouldReceive) {
      await tx.purchaseOrderItem.updateMany({
        where: { orderId: id },
        data: { receivedQty: 0 },
      })
      await Promise.all(
        existing.items.map(async (item) => {
          const qtyToReceive = item.quantity - item.receivedQty
          if (qtyToReceive <= 0) return

          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { receivedQty: item.quantity },
          })
          await tx.inventoryProduct.update({
            where: { id: item.productId },
            data: {
              onHandQty: { increment: qtyToReceive },
              costPriceCents: item.unitCostCents,
            },
          })
          await tx.inventoryStockMovement.create({
            data: {
              tenantId,
              productId: item.productId,
              orderItemId: item.id,
              type: "PURCHASE_RECEIPT",
              quantityDelta: qtyToReceive,
              unitCostCents: item.unitCostCents,
              note: `Purchase receipt ${existing.orderNumber}`,
            },
          })
        })
      )
    }

    return order
    }).catch((error: Error) => {
      if (error.message === "NOT_FOUND") {
        return null
      }
      throw error
    })

    if (!updated) {
      const response = NextResponse.json({ error: "Purchase order not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", orderId: id })
      return withRequestId(response, logContext.requestId)
    }

    const response = NextResponse.json({
      item: {
        id: updated.id,
        orderNumber: updated.orderNumber,
        supplier: updated.supplier,
        status: updated.status,
        orderDate: updated.orderDate.toISOString().slice(0, 10),
        expectedDate: updated.expectedDate
          ? updated.expectedDate.toISOString().slice(0, 10)
          : null,
        subtotalCents: updated.subtotalCents,
        taxCents: updated.taxCents,
        totalCents: updated.totalCents,
        createdAt: updated.createdAt.toISOString(),
        items: updated.items,
      },
    })
    logApiRequestSuccess(logContext, 200, { orderId: id, status: updated.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update purchase order." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventoryPurchases", "edit", actor => handlePATCH(request, actor, context), id)
}
