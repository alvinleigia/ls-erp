import { withServicesApi } from "@/modules/services/api"
import type { BusinessActor } from "@/platform/policy"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  createServiceSchema,
  serviceStatusSchema,
  serviceTypeSchema,
} from "@/lib/validation"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      "createdAt",
      "name",
      "status",
      "durationMinutes",
      "priceCents",
      "type",
      "category",
    ])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: serviceStatusSchema.optional(),
  categoryId: z.string().trim().optional(),
  type: serviceTypeSchema.optional(),
})

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  const url = new URL(request.url)
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid pagination parameters." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { page, pageSize, sort, order, q, status, categoryId, type } = parsed.data
    const skip = (page - 1) * pageSize
    const sortDir = order ?? "asc"
    const orderBy =
      sort === "category"
        ? { category: { name: sortDir } }
        : sort
          ? { [sort]: sortDir }
          : { createdAt: "desc" as const }
    const trimmedSearch = q?.trim()

    const where = {
      tenantId,
      ...(trimmedSearch
        ? {
            OR: [
              { name: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
              { description: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(type ? { type } : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.service.count({ where }),
      prisma.service.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          description: true,
          durationMinutes: true,
          priceCents: true,
          status: true,
          type: true,
          taxMode: true,
          createdAt: true,
          category: { select: { id: true, name: true } },
          packageItems: {
            select: { itemService: { select: { id: true, name: true } } },
          },
          defaultTaxes: { select: { taxId: true } },
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

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

  const {
    name,
    description,
    categoryId,
    durationMinutes,
    priceCents,
    status,
    type,
    packageItemIds,
    taxIds,
    taxMode,
  } = parsed.data

  if (type === "PACKAGE" && (!packageItemIds || packageItemIds.length === 0)) {
    const response = NextResponse.json(
      { error: "Package items are required." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "missing_package_items" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const category = await prisma.serviceCategory.findFirst({
      where: { id: categoryId, tenantId },
      select: { id: true },
    })
    if (!category) {
      const response = NextResponse.json({ error: "Service category not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "category_not_found" })
      return withRequestId(response, logContext.requestId)
    }
    if (packageItemIds?.length) {
      const packageItemsCount = await prisma.service.count({
        where: { tenantId, id: { in: packageItemIds } },
      })
      if (packageItemsCount !== packageItemIds.length) {
        const response = NextResponse.json(
          { error: "One or more package services were not found in this tenant." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "invalid_package_item_ids" })
        return withRequestId(response, logContext.requestId)
      }
    }
    if (taxIds?.length) {
      const uniqueTaxIds = [...new Set(taxIds)]
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

    const item = await prisma.service.create({
      data: {
        tenantId,
        name: name.trim(),
        description: description?.trim() || undefined,
        categoryId,
        durationMinutes,
        priceCents,
        status: status ?? "ACTIVE",
        type: type ?? "STANDARD",
        taxMode,
        packageItems:
          type === "PACKAGE" && packageItemIds?.length
            ? {
                create: packageItemIds.map((itemServiceId, index) => ({
                  itemServiceId,
                  sortOrder: index,
                })),
              }
            : undefined,
        defaultTaxes: taxIds?.length
          ? {
              create: [...new Set(taxIds)].map((taxId) => ({ taxId })),
            }
          : undefined,
      },
      select: {
        id: true,
        name: true,
        description: true,
        durationMinutes: true,
        priceCents: true,
        status: true,
        type: true,
        taxMode: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        packageItems: {
          select: { itemService: { select: { id: true, name: true } } },
        },
        defaultTaxes: { select: { taxId: true } },
      },
    })

    const response = NextResponse.json({
      item: {
        ...item,
        taxIds: item.defaultTaxes.map((tax) => tax.taxId),
      },
    })
    logApiRequestSuccess(logContext, 200, { serviceId: item.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create service." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export function GET(request: Request) { return withServicesApi(request, "services", "read", actor => handleGET(request, actor)) }

export function POST(request: Request) { return withServicesApi(request, "services", "create", actor => handlePOST(request, actor)) }
