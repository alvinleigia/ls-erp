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
import { updateInventoryProductSchema } from "@/lib/validation"


const serializeProduct = (item: {
  id: string
  sku: string
  name: string
  description: string | null
  unit: string
  status: "ACTIVE" | "INACTIVE"
  costPriceCents: number
  mrpCents: number
  reorderPoint: number
  reorderQty: number
  onHandQty: number
  isPhysical: boolean
  createdAt: Date
  category: { id: string; name: string }
  taxes: { taxId: string }[]
  suppliers: {
    supplierId: string
    supplierSku: string | null
    supplierCostCents: number | null
    minOrderQty: number
    leadTimeDays: number | null
    isPreferred: boolean
    supplier: { name: string }
  }[]
}) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  taxIds: item.taxes.map((tax) => tax.taxId),
  supplierLinks: item.suppliers.map((link) => ({
    supplierId: link.supplierId,
    supplierName: link.supplier.name,
    supplierSku: link.supplierSku,
    supplierCostCents: link.supplierCostCents,
    minOrderQty: link.minOrderQty,
    leadTimeDays: link.leadTimeDays,
    isPreferred: link.isPreferred,
  })),
})

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
    const parsed = updateInventoryProductSchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const data = parsed.data
    if (data.sku?.trim()) {
      const existing = await prisma.inventoryProduct.findUnique({
        where: { tenantId_sku: { tenantId, sku: data.sku.trim() } },
        select: { id: true },
      })
      if (existing && existing.id !== id) {
        const response = NextResponse.json({ error: "SKU already exists." }, { status: 409 })
        logApiRequestSuccess(logContext, 409, { reason: "duplicate_sku" })
        return withRequestId(response, logContext.requestId)
      }
    }

    if (data.supplierLinks) {
      const preferredCount = data.supplierLinks.filter((link) => link.isPreferred).length
      if (preferredCount > 1) {
        const response = NextResponse.json(
          { error: "Only one preferred supplier can be selected." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "multiple_preferred_suppliers" })
        return withRequestId(response, logContext.requestId)
      }
    }

    if (data.categoryId) {
      const category = await prisma.inventoryCategory.findFirst({
        where: { id: data.categoryId, tenantId },
        select: { id: true },
      })
      if (!category) {
        const response = NextResponse.json({ error: "Category not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "category_not_found" })
        return withRequestId(response, logContext.requestId)
      }
    }
    if (data.supplierLinks) {
      const supplierCount = await prisma.supplier.count({
        where: { tenantId, id: { in: data.supplierLinks.map((link) => link.supplierId) } },
      })
      if (supplierCount !== data.supplierLinks.length) {
        const response = NextResponse.json(
          { error: "One or more suppliers do not belong to this tenant." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "supplier_tenant_mismatch" })
        return withRequestId(response, logContext.requestId)
      }
    }
    if (data.taxIds?.length) {
      const uniqueTaxIds = [...new Set(data.taxIds)]
      const taxCount = await prisma.tax.count({
        where: { tenantId, id: { in: uniqueTaxIds }, isActive: true },
      })
      if (taxCount !== uniqueTaxIds.length) {
        const response = NextResponse.json(
          { error: "One or more taxes were not found in this tenant." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "invalid_tax_ids" })
        return withRequestId(response, logContext.requestId)
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryProduct.updateMany({
        where: { id, tenantId },
        data: {
          ...(data.sku?.trim() ? { sku: data.sku.trim() } : {}),
          ...(data.name?.trim() ? { name: data.name.trim() } : {}),
          ...(data.description !== undefined
            ? { description: data.description?.trim() || null }
            : {}),
          ...(data.unit ? { unit: data.unit } : {}),
          ...(data.categoryId ? { categoryId: data.categoryId } : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(typeof data.costPriceCents === "number"
            ? { costPriceCents: data.costPriceCents }
            : {}),
          ...(typeof data.mrpCents === "number" ? { mrpCents: data.mrpCents } : {}),
          ...(typeof data.reorderPoint === "number" ? { reorderPoint: data.reorderPoint } : {}),
          ...(typeof data.reorderQty === "number" ? { reorderQty: data.reorderQty } : {}),
          ...(typeof data.onHandQty === "number" ? { onHandQty: data.onHandQty } : {}),
          ...(typeof data.isPhysical === "boolean" ? { isPhysical: data.isPhysical } : {}),
        },
      })
      if (!updated.count) return null

      if (data.taxIds) {
        await tx.inventoryProductTax.deleteMany({ where: { productId: id } })
        if (data.taxIds.length > 0) {
          await tx.inventoryProductTax.createMany({
            data: [...new Set(data.taxIds)].map((taxId) => ({
              productId: id,
              taxId,
            })),
          })
        }
      }

      if (data.supplierLinks) {
        await tx.inventoryProductSupplier.deleteMany({ where: { productId: id } })
        if (data.supplierLinks.length > 0) {
          await tx.inventoryProductSupplier.createMany({
            data: data.supplierLinks.map((link) => ({
              productId: id,
              supplierId: link.supplierId,
              supplierSku: link.supplierSku?.trim() || null,
              supplierCostCents: link.supplierCostCents,
              minOrderQty: link.minOrderQty ?? 1,
              leadTimeDays: link.leadTimeDays,
              isPreferred: link.isPreferred ?? false,
            })),
          })
        }
      }

      return tx.inventoryProduct.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          unit: true,
          status: true,
          costPriceCents: true,
          mrpCents: true,
          reorderPoint: true,
          reorderQty: true,
          onHandQty: true,
          isPhysical: true,
          createdAt: true,
          category: { select: { id: true, name: true } },
          taxes: { select: { taxId: true } },
          suppliers: {
            orderBy: [{ isPreferred: "desc" }, { supplier: { name: "asc" } }],
            select: {
              supplierId: true,
              supplierSku: true,
              supplierCostCents: true,
              minOrderQty: true,
              leadTimeDays: true,
              isPreferred: true,
              supplier: { select: { name: true } },
            },
          },
        },
      })
    })

    const response = NextResponse.json({ item: item ? serializeProduct(item) : null })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
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
  const { tenantId } = actor

  try {
    const { id } = await params
    const linkedPurchases = await prisma.purchaseOrderItem.count({
      where: { productId: id, order: { tenantId } },
    })
    const hasStockMovements = await prisma.inventoryStockMovement.count({
      where: { productId: id, tenantId },
    })

    if (linkedPurchases > 0 || hasStockMovements > 0) {
      await prisma.inventoryProduct.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await prisma.inventoryProduct.deleteMany({ where: { id, tenantId } })
    }

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { itemId: id, linkedPurchases, hasStockMovements })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
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
