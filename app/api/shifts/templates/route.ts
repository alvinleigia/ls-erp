import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import { shiftTemplateSchema } from "@/lib/validation"
import { canManageUsers, type Role } from "@/lib/permissions"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import type { ListResponse } from "@/types/api"

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const url = new URL(request.url)
    const searchParams = url.searchParams
    const includeInactive = searchParams.get("includeInactive") === "true"
    const q = searchParams.get("q")?.trim()
    const status = searchParams.get("status")
    const sort = searchParams.get("sort") ?? "name"
    const order: Prisma.SortOrder = searchParams.get("order") === "desc" ? "desc" : "asc"
    const pageParamRaw = searchParams.get("page")
    const pageSizeParamRaw = searchParams.get("pageSize")
    const hasPagination = pageParamRaw !== null && pageSizeParamRaw !== null
    const pageParam = hasPagination ? Number(pageParamRaw) : NaN
    const pageSizeParam = hasPagination ? Number(pageSizeParamRaw) : NaN
    const page = hasPagination ? Math.max(1, pageParam) : 1
    const pageSize = hasPagination ? Math.max(1, pageSizeParam) : undefined

    const where: Prisma.ShiftTemplateWhereInput = { tenantId }

    if (!includeInactive) {
      if (status === "INACTIVE") {
        where.isActive = false
      } else if (status === "ACTIVE") {
        where.isActive = true
      } else {
        where.isActive = true
      }
    } else if (status === "INACTIVE") {
      where.isActive = false
    } else if (status === "ACTIVE") {
      where.isActive = true
    } else {
    }

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ]
    }

    let orderBy: Prisma.ShiftTemplateOrderByWithRelationInput
    switch (sort) {
      case "createdAt":
        orderBy = { createdAt: order }
        break
      case "updatedAt":
        orderBy = { updatedAt: order }
        break
      default:
        orderBy = { name: order }
    }

    const total = await prisma.shiftTemplate.count({ where })
    const templates = await prisma.shiftTemplate.findMany({
      where,
      include: { breaks: { orderBy: { sortOrder: "asc" } } },
      orderBy,
      skip: pageSize ? (page - 1) * pageSize : undefined,
      take: pageSize ?? undefined,
    })

    const effectivePageSize = pageSize ?? (total || templates.length || 1)
    const totalPages = Math.max(1, Math.ceil(total / effectivePageSize))
    const response: ListResponse<typeof templates[number]> = {
      items: templates,
      page,
      pageSize: effectivePageSize,
      total,
      totalPages,
    }

    const json = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize: effectivePageSize, total })
    return withRequestId(json, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load shift templates." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = workforceSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context
  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = shiftTemplateSchema.safeParse(body)
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
    const template = await prisma.shiftTemplate.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description || null,
        color: data.color || null,
        isActive: data.isActive ?? true,
        startTime: data.startTime,
        endTime: data.endTime,
        breaks: {
          create: data.breaks.map((period, index) => ({
            startTime: period.startTime,
            endTime: period.endTime,
            sortOrder: period.sortOrder ?? index,
          })),
        },
      },
      include: { breaks: { orderBy: { sortOrder: "asc" } } },
    })

    const response = NextResponse.json({ template })
    logApiRequestSuccess(logContext, 200, { templateId: template.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create shift template." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftTemplates", "create", actor => handlePOST(request, actor), "templates")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftTemplates", "read", actor => handleGET(request, actor), "templates")
}
