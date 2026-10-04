import { withInventoryApi } from "@/modules/inventory/api"
import type { BusinessActor } from "@/platform/policy"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import {
  createPurchaseOrderSchema,
  purchaseOrderStatusSchema,
} from "@/lib/validation"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "orderDate", "orderNumber", "status"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: purchaseOrderStatusSchema.optional(),
  supplierId: z.string().trim().optional(),
})


const toDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`)

const serializeOrder = (order: {
  id: string
  orderNumber: string
  status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELED"
  orderDate: Date
  expectedDate: Date | null
  subtotalCents: number
  taxCents: number
  totalCents: number
  createdAt: Date
  notes: string | null
  supplier: { id: string; name: string }
  items: {
    id: string
    quantity: number
    receivedQty: number
    unitCostCents: number
    taxPercent: number
    lineSubtotalCents: number
    lineTaxCents: number
    lineTotalCents: number
    product: { id: string; sku: string; name: string }
  }[]
}) => ({
  id: order.id,
  notes: order.notes,
  orderNumber: order.orderNumber,
  supplier: order.supplier,
  status: order.status,
  orderDate: order.orderDate.toISOString().slice(0, 10),
  expectedDate: order.expectedDate ? order.expectedDate.toISOString().slice(0, 10) : null,
  subtotalCents: order.subtotalCents,
  taxCents: order.taxCents,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  items: order.items,
})

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  const url = new URL(request.url)
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid pagination parameters.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { page, pageSize, sort, order, q, status, supplierId } = parsed.data
    const skip = (page - 1) * pageSize
    const orderBy = sort
      ? { [sort]: order ?? "desc" }
      : { createdAt: "desc" as const }
    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: "insensitive" } },
              { supplier: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
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
              product: { select: { id: true, sku: true, name: true } },
            },
          },
        },
      }),
    ])

    const response = NextResponse.json({
      items: items.map(serializeOrder),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load purchase orders." }, { status: 500 })
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
  const parsed = createPurchaseOrderSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const data = parsed.data
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "")
    const runningCount = await prisma.purchaseOrder.count({
      where: {
        tenantId,
        createdAt: { gte: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) },
      },
    })
    const orderNumber = `PO-${today}-${String(runningCount + 1).padStart(4, "0")}`

    const productIds = [...new Set(data.items.map((item) => item.productId))]
    const products = await prisma.inventoryProduct.findMany({
      where: { tenantId, id: { in: productIds } },
      select: {
        id: true,
        taxes: { select: { tax: { select: { percent: true } } } },
      },
    })
    const taxMap = new Map(
      products.map((product) => [
        product.id,
        product.taxes.reduce((sum, item) => sum + Math.max(0, item.tax.percent), 0),
      ])
    )

    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, tenantId },
      select: { id: true },
    })
    if (!supplier) {
      const response = NextResponse.json({ error: "Supplier not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "supplier_not_found" })
      return withRequestId(response, logContext.requestId)
    }
    if (products.length !== productIds.length) {
      const response = NextResponse.json(
        { error: "One or more products do not belong to this tenant." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "product_tenant_mismatch" })
      return withRequestId(response, logContext.requestId)
    }

    const linePayload = data.items.map((item) => {
      const quantity = Math.max(1, item.quantity)
      const unitCostCents = Math.max(0, item.unitCostCents)
      const taxPercent = taxMap.get(item.productId) ?? 0
      const lineSubtotalCents = quantity * unitCostCents
      const lineTaxCents = Math.round((lineSubtotalCents * taxPercent) / 100)
      const lineTotalCents = lineSubtotalCents + lineTaxCents
      return {
        ...item,
        quantity,
        unitCostCents,
        taxPercent,
        lineSubtotalCents,
        lineTaxCents,
        lineTotalCents,
        receivedQty: data.status === "RECEIVED" ? quantity : 0,
      }
    })

    const subtotalCents = linePayload.reduce((sum, item) => sum + item.lineSubtotalCents, 0)
    const taxCents = linePayload.reduce((sum, item) => sum + item.lineTaxCents, 0)
    const totalCents = subtotalCents + taxCents
    const initialStatus = data.status ?? "ORDERED"

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
      data: {
        tenantId,
        orderNumber,
        supplierId: data.supplierId,
        status: initialStatus,
        orderDate: toDateOnly(data.orderDate),
        expectedDate: data.expectedDate ? toDateOnly(data.expectedDate) : null,
        notes: data.notes?.trim() || undefined,
        subtotalCents,
        taxCents,
        totalCents,
        receivedAt: initialStatus === "RECEIVED" ? new Date() : null,
        items: {
          create: linePayload.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            receivedQty: item.receivedQty,
            unitCostCents: item.unitCostCents,
            taxPercent: item.taxPercent,
            lineSubtotalCents: item.lineSubtotalCents,
            lineTaxCents: item.lineTaxCents,
            lineTotalCents: item.lineTotalCents,
          })),
        },
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

      if (initialStatus === "RECEIVED") {
        await Promise.all(
          order.items.map((item) =>
            tx.inventoryProduct.update({
              where: { id: item.productId },
              data: {
                onHandQty: { increment: item.quantity },
                costPriceCents: item.unitCostCents,
              },
            })
          )
        )
        await tx.inventoryStockMovement.createMany({
          data: order.items.map((item) => ({
            tenantId,
            productId: item.productId,
            orderItemId: item.id,
            type: "PURCHASE_RECEIPT",
            quantityDelta: item.quantity,
            unitCostCents: item.unitCostCents,
            note: `Purchase receipt ${order.orderNumber}`,
          })),
        })
      }

      return order
    })

    const response = NextResponse.json({ item: serializeOrder(created) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { purchaseOrderId: created.id, status: created.status })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create purchase order." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withInventoryApi(request, "inventoryPurchases", "read", actor => handleGET(request, actor))
}

export async function POST(request: Request) {
  return withInventoryApi(request, "inventoryPurchases", "create", actor => handlePOST(request, actor))
}
