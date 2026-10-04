import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import type { ListResponse } from "@/types/api"
import type { StaffFlexiblePatternListItem } from "@/types/shifts"

const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10)

const toIsoTimestamp = (value: Date) => value.toISOString()

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
    const q = searchParams.get("q")?.trim()
    const staffId = searchParams.get("staffId")?.trim()
    const isActiveParam = searchParams.get("isActive")?.trim().toLowerCase()
    const effectiveOn = searchParams.get("effectiveOn")?.trim()
    const sort = searchParams.get("sort") ?? "updatedAt"
    const order: Prisma.SortOrder = searchParams.get("order") === "asc" ? "asc" : "desc"
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"))
    const pageSize = Math.max(1, Number(searchParams.get("pageSize") ?? "10"))

    if (effectiveOn && !dateRegex.test(effectiveOn)) {
      const response = NextResponse.json({ error: "effectiveOn must be YYYY-MM-DD." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_effective_on" })
      return withRequestId(response, logContext.requestId)
    }

    const andConditions: Prisma.StaffFlexiblePatternWhereInput[] = []
    const where: Prisma.StaffFlexiblePatternWhereInput = {
      staffProfile: {
        user: {
          tenantId,
          role: "STAFF",
        },
      },
      AND: andConditions,
    }

    if (staffId) {
      where.staffProfile = {
        userId: staffId,
        user: {
          tenantId,
          role: "STAFF",
        },
      }
    }

    if (isActiveParam === "true") {
      where.isActive = true
    } else if (isActiveParam === "false") {
      where.isActive = false
    }

    if (effectiveOn) {
      const effectiveOnDate = new Date(`${effectiveOn}T00:00:00.000Z`)
      andConditions.push({
        validFrom: { lte: effectiveOnDate },
        OR: [{ validTo: null }, { validTo: { gte: effectiveOnDate } }],
      })
    }

    if (q) {
      andConditions.push({
        OR: [
        { name: { contains: q, mode: "insensitive" } },
        { staffProfile: { user: { name: { contains: q, mode: "insensitive" } } } },
        { staffProfile: { user: { email: { contains: q, mode: "insensitive" } } } },
        ],
      })
    }

    let orderBy: Prisma.StaffFlexiblePatternOrderByWithRelationInput
    switch (sort) {
      case "validFrom":
        orderBy = { validFrom: order }
        break
      case "createdAt":
        orderBy = { createdAt: order }
        break
      default:
        orderBy = { updatedAt: order }
        break
    }

    const [total, rows] = await Promise.all([
      prisma.staffFlexiblePattern.count({ where }),
      prisma.staffFlexiblePattern.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          staffProfile: {
            select: {
              id: true,
              userId: true,
              user: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ])

    const effectiveDate = new Date(
      `${(effectiveOn && dateRegex.test(effectiveOn) ? effectiveOn : toDateOnly(new Date()))}T00:00:00.000Z`
    )
    const items: StaffFlexiblePatternListItem[] = rows.map((row) => {
      const validFromTs = new Date(`${toDateOnly(row.validFrom)}T00:00:00.000Z`).getTime()
      const validToTs = row.validTo
        ? new Date(`${toDateOnly(row.validTo)}T23:59:59.999Z`).getTime()
        : Number.POSITIVE_INFINITY
      const effectiveTs = effectiveDate.getTime()
      return {
        id: row.id,
        staffId: row.staffProfile.userId,
        staffProfileId: row.staffProfile.id,
        staffName: row.staffProfile.user.name,
        staffEmail: row.staffProfile.user.email,
        name: row.name,
        cycleLengthWeeks: row.cycleLengthWeeks,
        validFrom: toDateOnly(row.validFrom),
        validTo: row.validTo ? toDateOnly(row.validTo) : null,
        isActive: row.isActive,
        isCurrentlyEffective: row.isActive && effectiveTs >= validFromTs && effectiveTs <= validToTs,
        createdAt: toIsoTimestamp(row.createdAt),
        updatedAt: toIsoTimestamp(row.updatedAt),
      }
    })

    const response: ListResponse<StaffFlexiblePatternListItem> = {
      items,
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
    const response = NextResponse.json({ error: "Unable to load recurring flexible patterns." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "shifts", "shiftPlans", "read", actor => handleGET(request, actor), "flexible-patterns/list")
}
