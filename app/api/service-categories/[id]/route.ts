import { withServicesApi } from "@/modules/services/api"
import type { BusinessActor } from "@/platform/policy"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma } from "@/lib/prisma"
import { updateServiceCategorySchema } from "@/lib/validation"

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: BusinessActor
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const { tenantId } = actor

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", categoryId: id })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = updateServiceCategorySchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", categoryId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const data = parsed.data
    if (data.name?.trim()) {
      const existing = await prisma.serviceCategory.findFirst({
        where: { tenantId, name: data.name.trim() },
        select: { id: true },
      })
      if (existing && existing.id !== id) {
        const response = NextResponse.json(
          { error: "Category name already exists." },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "name_conflict", categoryId: id })
        return withRequestId(response, logContext.requestId)
      }
    }

    const item = await prisma.serviceCategory.updateManyAndReturn({
      where: { id, tenantId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.description?.trim()
          ? { description: data.description.trim() }
          : data.description === ""
            ? { description: null }
            : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
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

    const response = NextResponse.json({ item: item[0] ?? null })
    logApiRequestSuccess(logContext, 200, { categoryId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { categoryId: id })
    const response = NextResponse.json({ error: "Unable to update category." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  actor: BusinessActor
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const { tenantId } = actor

  try {
    const linkedServices = await prisma.service.count({
      where: { tenantId, categoryId: id },
    })
    if (linkedServices > 0) {
      await prisma.serviceCategory.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await prisma.serviceCategory.deleteMany({ where: { id, tenantId } })
    }

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, {
      categoryId: id,
      result: linkedServices > 0 ? "soft_deleted" : "hard_deleted",
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { categoryId: id })
    const response = NextResponse.json({ error: "Unable to delete category." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withServicesApi(request, "serviceCategories", "edit", actor => handlePATCH(request, context, actor), id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withServicesApi(request, "serviceCategories", "archive", actor => handleDELETE(request, context, actor), id)
}
