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
import { updateServiceSchema } from "@/lib/validation"

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
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", serviceId: id })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = updateServiceSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", serviceId: id })
    return withRequestId(response, logContext.requestId)
  }

  const data = parsed.data

  if (data.type === "PACKAGE" && data.packageItemIds?.length === 0) {
    const response = NextResponse.json(
      { error: "Package items are required." },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "missing_package_items", serviceId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    if (data.categoryId) {
      const category = await prisma.serviceCategory.findFirst({
        where: { id: data.categoryId, tenantId },
        select: { id: true },
      })
      if (!category) {
        const response = NextResponse.json({ error: "Service category not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "category_not_found", serviceId: id })
        return withRequestId(response, logContext.requestId)
      }
    }
    if (data.packageItemIds?.length) {
      const packageItemsCount = await prisma.service.count({
        where: { tenantId, id: { in: data.packageItemIds } },
      })
      if (packageItemsCount !== data.packageItemIds.length) {
        const response = NextResponse.json(
          { error: "One or more package services were not found in this tenant." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "invalid_package_item_ids", serviceId: id })
        return withRequestId(response, logContext.requestId)
      }
    }
    if (data.taxIds?.length) {
      const uniqueTaxIds = [...new Set(data.taxIds)]
      const taxCount = await prisma.tax.count({
        where: { tenantId, id: { in: uniqueTaxIds }, isActive: true },
      })
      if (taxCount !== uniqueTaxIds.length) {
        const response = NextResponse.json(
          { error: "One or more taxes were not found in this tenant." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "invalid_tax_ids", serviceId: id })
        return withRequestId(response, logContext.requestId)
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.service.updateMany({
        where: { id, tenantId },
        data: {
          ...(data.name?.trim() ? { name: data.name.trim() } : {}),
          ...(data.description?.trim()
            ? { description: data.description.trim() }
            : data.description === ""
              ? { description: null }
              : {}),
          ...(data.categoryId ? { categoryId: data.categoryId } : {}),
          ...(typeof data.durationMinutes === "number"
            ? { durationMinutes: data.durationMinutes }
            : {}),
          ...(typeof data.priceCents === "number"
            ? { priceCents: data.priceCents }
            : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(data.type ? { type: data.type } : {}),
          ...(data.taxMode ? { taxMode: data.taxMode } : {}),

        },
      })
      if (!updated.count) {
        return null
      }

      if (data.taxIds) {
        await tx.serviceTax.deleteMany({ where: { serviceId: id, service: { tenantId } } })
        if (data.taxIds.length) await tx.serviceTax.createMany({ data: [...new Set(data.taxIds)].map(taxId => ({ serviceId: id, taxId })) })
      }
      if (data.packageItemIds) {
        await tx.servicePackageItem.deleteMany({
          where: { packageId: id, package: { tenantId } },
        })
        if (data.packageItemIds.length > 0) {
          await tx.servicePackageItem.createMany({
            data: data.packageItemIds.map((itemServiceId, index) => ({
              packageId: id,
              itemServiceId,
              sortOrder: index,
            })),
          })
        }
      }

      return tx.service.findFirst({
        where: { id, tenantId },
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
    })

    const response = NextResponse.json({
      item: item
        ? {
            ...item,
            taxIds: item.defaultTaxes.map((tax) => tax.taxId),
          }
        : null,
    })
    logApiRequestSuccess(logContext, 200, { serviceId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { serviceId: id })
    const response = NextResponse.json({ error: "Unable to update service." }, { status: 500 })
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
    const packageAssociations = await prisma.servicePackageItem.count({
      where: {
        package: { tenantId },
        OR: [{ packageId: id }, { itemServiceId: id }],
      },
    })

    const [appointments, orderLines, eligibility] = await Promise.all([
      prisma.appointment.count({ where: { tenantId, serviceId: id } }),
      prisma.appointmentOrderLine.count({ where: { serviceId: id, order: { tenantId } } }),
      prisma.staffServiceEligibility.count({ where: { serviceId: id, user: { tenantId } } }),
    ])
    const associations = packageAssociations + appointments + orderLines + eligibility
    if (associations > 0) {
      await prisma.service.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await prisma.service.deleteMany({ where: { id, tenantId } })
    }

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, {
      serviceId: id,
      result: associations > 0 ? "soft_deleted" : "hard_deleted",
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500, { serviceId: id })
    const response = NextResponse.json({ error: "Unable to delete service." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withServicesApi(request, "services", "edit", actor => handlePATCH(request, context, actor), id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withServicesApi(request, "services", "archive", actor => handleDELETE(request, context, actor), id)
}
