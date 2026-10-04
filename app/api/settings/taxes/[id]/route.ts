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
import { canManageUsers, type Role } from "@/lib/permissions"
import { withCoreApi, actorSession } from "@/platform/core/api"
import type { BusinessActor } from "@/platform/policy"
import { taxUpdateSchema } from "@/lib/validation"
import type { TaxRow } from "@/types/scheduling"

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

async function handlePATCH(request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(actor)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  const { id } = await params
  const payload = await request.json().catch(() => null)
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", taxId: id })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = taxUpdateSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", taxId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const data = parsed.data
    const existing = await prisma.tax.findFirst({
      where: { id, tenantId },
      select: { id: true },
    })
    if (!existing) {
      const response = NextResponse.json({ error: "Tax not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", taxId: id })
      return withRequestId(response, logContext.requestId)
    }
    const tax = await prisma.tax.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.percent !== undefined ? { percent: data.percent } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    })

    const response = NextResponse.json({ tax: serializeTax(tax) })
    logApiRequestSuccess(logContext, 200, { taxId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const response = NextResponse.json({ error: "Tax name already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "name_conflict", taxId: id })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500, { taxId: id })
    const response = NextResponse.json({ error: "Unable to update tax." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(request: Request,
  { params }: { params: Promise<{ id: string }> }, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(actor)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_tenant_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId } = authorized.context

  const { id } = await params

  try {
    const inUse = await prisma.appointmentOrderTax.findFirst({
      where: { taxId: id, order: { tenantId } },
      select: { id: true },
    })
    if (inUse) {
      const response = NextResponse.json(
        { error: "Tax cannot be deleted because it is used in booking orders." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "in_use", taxId: id })
      return withRequestId(response, logContext.requestId)
    }

    const deleted = await prisma.tax.deleteMany({ where: { id, tenantId } })
    if (deleted.count === 0) {
      const response = NextResponse.json({ error: "Tax not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", taxId: id })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { taxId: id, result: "deleted" })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { taxId: id })
    const response = NextResponse.json({ error: "Unable to delete tax." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withCoreApi(request, "taxRates", "edit", actor => handlePATCH(request, context, actor), (await context.params).id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withCoreApi(request, "taxRates", "archive", actor => handleDELETE(request, context, actor), (await context.params).id)
}
