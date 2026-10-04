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
import { updateLeaveGroupSchema } from "@/lib/validation"
import {
  leaveGroupSelect,
  replaceGroupLeaves,
  replaceGroupStaffAssignments,
  serializeLeaveGroup,
} from "../../_groups"

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
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
    const { id } = await params
    const item = await prisma.leaveGroup.findFirst({
      where: { id, tenantId },
      select: leaveGroupSelect,
    })
    if (!item) {
      const response = NextResponse.json({ error: "Leave group not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({ item: serializeLeaveGroup(item) })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load leave group." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
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
    const { id } = await params
    const current = await prisma.leaveGroup.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true, name: true, assignmentMode: true },
    })
    if (!current) {
      const response = NextResponse.json({ error: "Leave group not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

    const payload = await request.json().catch(() => ({}))
    const parsed = updateLeaveGroupSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const code = parsed.data.code?.trim().toUpperCase()
    const name = parsed.data.name?.trim()
    if (code || name) {
      const existing = await prisma.leaveGroup.findFirst({
        where: {
          tenantId,
          id: { not: id },
          OR: [...(code ? [{ code }] : []), ...(name ? [{ name }] : [])],
        },
        select: { id: true, code: true },
      })
      if (existing) {
        const response = NextResponse.json(
          { error: code && existing.code === code ? "Leave group code already exists." : "Leave group name already exists." },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "duplicate_code_or_name" })
        return withRequestId(response, logContext.requestId)
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      const assignmentMode = parsed.data.assignmentMode ?? current.assignmentMode
      const updated = await tx.leaveGroup.updateMany({
        where: { id, tenantId },
        data: {
          ...(code ? { code } : {}),
          ...(name ? { name } : {}),
          ...(parsed.data.description !== undefined
            ? { description: parsed.data.description.trim() || null }
            : {}),
          ...(parsed.data.assignmentMode ? { assignmentMode: parsed.data.assignmentMode } : {}),
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(typeof parsed.data.sortOrder === "number" ? { sortOrder: parsed.data.sortOrder } : {}),
        },
      })
      if (!updated.count) throw new Error("Leave group not found.")

      if (parsed.data.leaveDefinitionIds) {
        await replaceGroupLeaves(tx, id, parsed.data.leaveDefinitionIds, tenantId)
      }
      if (parsed.data.staffIds || parsed.data.assignmentMode) {
        await replaceGroupStaffAssignments(
          tx,
          id,
          assignmentMode,
          parsed.data.staffIds ?? [],
          tenantId
        )
      }

      return tx.leaveGroup.findFirstOrThrow({
        where: { id, tenantId },
        select: leaveGroupSelect,
      })
    })

    const response = NextResponse.json({ item: serializeLeaveGroup(item) })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "domain_error", message: error.message })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update leave group." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
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
    const { id } = await params
    const exists = await prisma.leaveGroup.findFirst({ where: { id, tenantId }, select: { id: true } })
    if (!exists) {
      const response = NextResponse.json({ error: "Leave group not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", itemId: id })
      return withRequestId(response, logContext.requestId)
    }

    await prisma.leaveGroup.deleteMany({ where: { id, tenantId } })
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { itemId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete leave group." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveGroups", "archive", actor => handleDELETE(request, context, actor), "groups/[id]", (await context.params).id)
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveGroups", "edit", actor => handlePATCH(request, context, actor), "groups/[id]", (await context.params).id)
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkforceApi(request, "leaves", "leaveGroups", "read", actor => handleGET(request, context, actor), "groups/[id]", (await context.params).id)
}
