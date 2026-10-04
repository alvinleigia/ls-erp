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
  createInventoryProductSchema,
  inventoryProductStatusSchema,
} from "@/lib/validation"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      "createdAt",
      "sku",
      "name",
      "status",
      "mrpCents",
      "costPriceCents",
      "onHandQty",
      "category",
    ])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: inventoryProductStatusSchema.optional(),
  categoryId: z.string().trim().optional(),
})


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
  id: item.id,
  sku: item.sku,
  name: item.name,
  description: item.description,
  unit: item.unit,
  status: item.status,
  costPriceCents: item.costPriceCents,
  mrpCents: item.mrpCents,
  reorderPoint: item.reorderPoint,
  reorderQty: item.reorderQty,
  onHandQty: item.onHandQty,
  isPhysical: item.isPhysical,
  createdAt: item.createdAt.toISOString(),
  category: item.category,
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
    const { page, pageSize, sort, order, q, status, categoryId } = parsed.data
    const skip = (page - 1) * pageSize
    const sortDirection = order ?? "asc"
    const orderBy =
      sort === "category"
        ? { category: { name: sortDirection } }
        : sort
          ? { [sort]: sortDirection }
          : { createdAt: "desc" as const }
    const where: Prisma.InventoryProductWhereInput = {
      tenantId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.inventoryProduct.count({ where }),
      prisma.inventoryProduct.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
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
      }),
    ])

    const response = NextResponse.json({
      items: items.map(serializeProduct),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load inventory products." }, { status: 500 })
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
  const parsed = createInventoryProductSchema.safeParse(body)
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
    const existing = await prisma.inventoryProduct.findFirst({
      where: { tenantId, sku: data.sku.trim() },
      select: { id: true },
    })
    if (existing) {
      const response = NextResponse.json({ error: "SKU already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "sku_conflict" })
      return withRequestId(response, logContext.requestId)
    }

    const preferredCount = data.supplierLinks.filter((link) => link.isPreferred).length
    if (preferredCount > 1) {
      const response = NextResponse.json(
        { error: "Only one preferred supplier can be selected." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "multiple_preferred_suppliers" })
      return withRequestId(response, logContext.requestId)
    }

    const category = await prisma.inventoryCategory.findFirst({
      where: { id: data.categoryId, tenantId },
      select: { id: true },
    })
    if (!category) {
      const response = NextResponse.json({ error: "Category not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "category_not_found" })
      return withRequestId(response, logContext.requestId)
    }
    if (data.supplierLinks.length) {
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
    if (data.taxIds.length) {
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

    const item = await prisma.inventoryProduct.create({
      data: {
        tenantId,
        sku: data.sku.trim(),
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        unit: data.unit ?? "unit",
        categoryId: data.categoryId,
        status: data.status ?? "ACTIVE",
        costPriceCents: data.costPriceCents,
        mrpCents: data.mrpCents,
        reorderPoint: data.reorderPoint ?? 0,
        reorderQty: data.reorderQty ?? 0,
        onHandQty: data.onHandQty ?? 0,
        isPhysical: data.isPhysical ?? true,
        taxes: data.taxIds.length
          ? {
              create: [...new Set(data.taxIds)].map((taxId) => ({ taxId })),
            }
          : undefined,
        suppliers: data.supplierLinks.length
          ? {
              create: data.supplierLinks.map((link) => ({
                supplierId: link.supplierId,
                supplierSku: link.supplierSku?.trim() || undefined,
                supplierCostCents: link.supplierCostCents,
                minOrderQty: link.minOrderQty ?? 1,
                leadTimeDays: link.leadTimeDays,
                isPreferred: link.isPreferred ?? false,
              })),
            }
          : undefined,
      },
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

    const response = NextResponse.json({ item: serializeProduct(item) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { productId: item.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create inventory product." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withInventoryApi(request, "inventoryProducts", "read", actor => handleGET(request, actor))
}

export async function POST(request: Request) {
  return withInventoryApi(request, "inventoryProducts", "create", actor => handlePOST(request, actor))
}
