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
import { canManageUsers, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withWorkforceApi, workforceSession } from "@/modules/workforce/api"
import type { BusinessActor } from "@/platform/policy"
import {
  createLeaveDefinitionSchema,
  leaveDefinitionAllowedUsersSchema,
  leaveDefinitionStatusSchema,
  leaveDefinitionTypeSchema,
} from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { LeaveDefinitionRow } from "@/types/leaves"
import {
  leaveDefinitionSelect,
  replaceNonClubbableRules,
  serializeLeaveDefinition,
} from "../_definitions"

const leaveDefinitionListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: leaveDefinitionStatusSchema.optional(),
  leaveType: leaveDefinitionTypeSchema.optional(),
  allowedUsers: leaveDefinitionAllowedUsersSchema.optional(),
  sort: z
    .enum(["code", "name", "leaveType", "allowedUsers", "status", "sortOrder", "createdAt", "updatedAt"])
    .default("sortOrder"),
  order: z.enum(["asc", "desc"]).default("asc"),
})

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
    const parsed = leaveDefinitionListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    )
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid query parameters.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const { page, pageSize, q, status, leaveType, allowedUsers, sort, order } = parsed.data
    const where: Prisma.LeaveDefinitionWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(leaveType ? { leaveType } : {}),
      ...(allowedUsers ? { allowedUsers } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.leaveDefinition.count({ where }),
      prisma.leaveDefinition.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sort]: order },
        select: leaveDefinitionSelect,
      }),
    ])

    const response: ListResponse<LeaveDefinitionRow> = {
      items: items.map(serializeLeaveDefinition),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
    const jsonResponse = NextResponse.json(response)
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(jsonResponse, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave definitions." }, { status: 500 })
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

  try {
    const payload = await request.json().catch(() => ({}))
    const parsed = createLeaveDefinitionSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const code = parsed.data.code.trim().toUpperCase()
    const name = parsed.data.name.trim()
    const existing = await prisma.leaveDefinition.findFirst({
      where: { tenantId, OR: [{ code }, { name }] },
      select: { id: true, code: true, name: true },
    })
    if (existing) {
      const response = NextResponse.json(
        {
          error:
            existing.code === code
              ? "Leave code already exists."
              : "Leave name already exists.",
        },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "duplicate_code_or_name" })
      return withRequestId(response, logContext.requestId)
    }

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.leaveDefinition.create({
        data: {
          tenantId,
          code,
          name,
          leaveType: parsed.data.leaveType,
          allowedUsers: parsed.data.allowedUsers,
          minDaysPerRequest: parsed.data.minDaysPerRequest,
          maxDaysPerRequest: parsed.data.maxDaysPerRequest,
          allowWithOtherLeaves: parsed.data.allowWithOtherLeaves,
          priorEntryAllowed: parsed.data.priorEntryAllowed,
          noticeDays: parsed.data.noticeDays,
          allowCarryForward: parsed.data.allowCarryForward,
          weekOffSingleSideAllowed: parsed.data.weekOffSingleSideAllowed,
          weekOffBothSideAllowed: parsed.data.weekOffBothSideAllowed,
          holidaySingleSideAllowed: parsed.data.holidaySingleSideAllowed,
          holidayBothSideAllowed: parsed.data.holidayBothSideAllowed,
          maxConsecutiveDays: parsed.data.maxDaysPerRequest,
          maxPendingRequests: parsed.data.maxPendingRequests,
          status: parsed.data.status,
          sortOrder: parsed.data.sortOrder,
        },
      })
      await replaceNonClubbableRules(tx, created.id, parsed.data.nonClubbableWithIds, tenantId)
      return tx.leaveDefinition.findFirstOrThrow({
        where: { id: created.id, tenantId },
        select: leaveDefinitionSelect,
      })
    })
    const response = NextResponse.json({ item: serializeLeaveDefinition(item) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { itemId: item.id, code: item.code })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create leave definition." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "create", actor => handlePOST(request, actor), "definitions")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveDefinitions", "read", actor => handleGET(request, actor), "definitions")
}
