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
import { canManageUsers, type Role } from "@/lib/permissions"
import { withCoreApi, actorSession } from "@/platform/core/api"
import type { BusinessActor } from "@/platform/policy"
import { taxCreateSchema } from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { TaxRow } from "@/types/scheduling"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  active: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
})

const ensureAuthorized = async (actor: BusinessActor) => {
  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    return { error: tenantSession.error }
  }
  if (!canManageUsers(tenantSession.context.role as Role)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { context: tenantSession.context }
}

const serializeTax = (tax: {
  id: string
  name: string
  percent: number
  isActive: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): TaxRow => ({
  id: tax.id,
  name: tax.name,
  percent: tax.percent,
  isActive: tax.isActive,
  sortOrder: tax.sortOrder,
  createdAt: tax.createdAt.toISOString(),
  updatedAt: tax.updatedAt.toISOString(),
})

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(actor)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  const url = new URL(request.url)
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid query parameters.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { page, pageSize, q, active } = parsed.data
    const where: Prisma.TaxWhereInput = { tenantId }
    if (q) {
      where.name = { contains: q, mode: "insensitive" }
    }
    if (active !== undefined) {
      where.isActive = active
    }

    const skip = (page - 1) * pageSize
    const [total, items] = await prisma.$transaction([
      prisma.tax.count({ where }),
      prisma.tax.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take: pageSize,
      }),
    ])

    const response: ListResponse<TaxRow> = {
      items: items.map(serializeTax),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }

    const json = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(json, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load taxes." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(actor)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  const payload = await request.json().catch(() => null)
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = taxCreateSchema.safeParse(payload)
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
    const tax = await prisma.tax.create({
      data: {
        tenantId,
        name: data.name.trim(),
        percent: data.percent,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    })

    const response = NextResponse.json({ tax: serializeTax(tax) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { taxId: tax.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const response = NextResponse.json({ error: "Tax name already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "name_conflict" })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create tax." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withCoreApi(request, "taxRates", "read", actor => handleGET(request, actor))
}

export async function POST(request: Request) {
  return withCoreApi(request, "taxRates", "create", actor => handlePOST(request, actor))
}
