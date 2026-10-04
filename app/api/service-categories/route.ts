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
  createServiceCategorySchema,
  serviceCategoryStatusSchema,
} from "@/lib/validation"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "status", "sortOrder"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: serviceCategoryStatusSchema.optional(),
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
    const { page, pageSize, sort, order, q, status } = parsed.data
    const skip = (page - 1) * pageSize
    const orderBy = sort
      ? { [sort]: order ?? "asc" }
      : { sortOrder: "asc" as const }
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
    }

    const [total, items] = await prisma.$transaction([
      prisma.serviceCategory.count({ where }),
      prisma.serviceCategory.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          sortOrder: true,
          createdAt: true,
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const response = NextResponse.json({ items, page, pageSize, total, totalPages })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load service categories." }, { status: 500 })
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
  const parsed = createServiceCategorySchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  const { name, description, status, sortOrder } = parsed.data

  try {
    const existing = await prisma.serviceCategory.findFirst({
      where: { tenantId, name: name.trim() },
      select: { id: true },
    })
    if (existing) {
      const response = NextResponse.json(
        { error: "Category name already exists." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "name_conflict" })
      return withRequestId(response, logContext.requestId)
    }

    const item = await prisma.serviceCategory.create({
      data: {
        tenantId,
        name: name.trim(),
        description: description?.trim() || undefined,
        status: status ?? "ACTIVE",
        sortOrder: sortOrder ?? 0,
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        sortOrder: true,
        createdAt: true,
      },
    })

    const response = NextResponse.json({ item })
    logApiRequestSuccess(logContext, 200, { categoryId: item.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create service category." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export function GET(request: Request) { return withServicesApi(request, "serviceCategories", "read", actor => handleGET(request, actor)) }

export function POST(request: Request) { return withServicesApi(request, "serviceCategories", "create", actor => handlePOST(request, actor)) }
