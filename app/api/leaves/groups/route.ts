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
  createLeaveGroupSchema,
  leaveGroupAssignmentModeSchema,
  leaveGroupStatusSchema,
} from "@/lib/validation"
import type { ListResponse } from "@/types/api"
import type { LeaveGroupRow } from "@/types/leaves"
import {
  leaveGroupSelect,
  replaceGroupLeaves,
  replaceGroupStaffAssignments,
  serializeLeaveGroup,
} from "../_groups"

const leaveGroupListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: leaveGroupStatusSchema.optional(),
  assignmentMode: leaveGroupAssignmentModeSchema.optional(),
  sort: z
    .enum(["code", "name", "assignmentMode", "status", "sortOrder", "updatedAt", "createdAt"])
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
    const parsed = leaveGroupListSchema.safeParse(
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

    const { page, pageSize, q, status, assignmentMode, sort, order } = parsed.data
    const where: Prisma.LeaveGroupWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(assignmentMode ? { assignmentMode } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.leaveGroup.count({ where }),
      prisma.leaveGroup.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sort]: order },
        select: leaveGroupSelect,
      }),
    ])

    const response: ListResponse<LeaveGroupRow> = {
      items: items.map(serializeLeaveGroup),
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
    const response = NextResponse.json({ error: "Unable to load leave groups." }, { status: 500 })
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
    const parsed = createLeaveGroupSchema.safeParse(payload)
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
    const description = parsed.data.description?.trim() || null
    const existing = await prisma.leaveGroup.findFirst({
      where: { tenantId, OR: [{ code }, { name }] },
      select: { id: true, code: true },
    })
    if (existing) {
      const response = NextResponse.json(
        { error: existing.code === code ? "Leave group code already exists." : "Leave group name already exists." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "duplicate_code_or_name" })
      return withRequestId(response, logContext.requestId)
    }

    const item = await prisma.$transaction(async (tx) => {
      const group = await tx.leaveGroup.create({
        data: {
          tenantId,
          code,
          name,
          description,
          assignmentMode: parsed.data.assignmentMode,
          status: parsed.data.status,
          sortOrder: parsed.data.sortOrder,
        },
      })
      await replaceGroupLeaves(tx, group.id, parsed.data.leaveDefinitionIds, tenantId)
      await replaceGroupStaffAssignments(
        tx,
        group.id,
        parsed.data.assignmentMode,
        parsed.data.staffIds,
        tenantId
      )
      return tx.leaveGroup.findFirstOrThrow({
        where: { id: group.id, tenantId },
        select: leaveGroupSelect,
      })
    })

    const response = NextResponse.json({ item: serializeLeaveGroup(item) }, { status: 201 })
    logApiRequestSuccess(logContext, 201, { itemId: item.id, code: item.code })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create leave group." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveGroups", "create", actor => handlePOST(request, actor), "groups")
}

export async function GET(request: Request) {
  return withWorkforceApi(request, "leaves", "leaveGroups", "read", actor => handleGET(request, actor), "groups")
}
