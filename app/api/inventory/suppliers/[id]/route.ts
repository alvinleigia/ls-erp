import { withInventoryApi } from "@/modules/inventory/api"
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
import { updateSupplierSchema } from "@/lib/validation"


async function handlePATCH(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)
  const { tenantId } = actor

  try {
    const { id } = await params
    const body = await request.json()
    const parsed = updateSupplierSchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const data = parsed.data
    const supplier = await prisma.supplier.updateManyAndReturn({
      where: { id, tenantId },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.contactPerson !== undefined
          ? { contactPerson: data.contactPerson?.trim() || null }
          : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.isTaxRegistered !== undefined ? { isTaxRegistered: data.isTaxRegistered } : {}),
        ...(data.taxRegistrationType !== undefined
          ? { taxRegistrationType: data.taxRegistrationType || null }
          : {}),
        ...(data.taxRegistrationNumber !== undefined
          ? { taxRegistrationNumber: data.taxRegistrationNumber?.trim() || null }
          : {}),
        ...(typeof data.leadTimeDays === "number" ? { leadTimeDays: data.leadTimeDays } : {}),
        ...(data.addressLine1 !== undefined
          ? { addressLine1: data.addressLine1?.trim() || null }
          : {}),
        ...(data.addressLine2 !== undefined
          ? { addressLine2: data.addressLine2?.trim() || null }
          : {}),
        ...(data.city !== undefined ? { city: data.city?.trim() || null } : {}),
        ...(data.state !== undefined ? { state: data.state?.trim() || null } : {}),
        ...(data.postalCode !== undefined
          ? { postalCode: data.postalCode?.trim() || null }
          : {}),
        ...(data.country !== undefined ? { country: data.country?.trim() || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
      select: {
        id: true,
        name: true,
        contactPerson: true,
        email: true,
        phone: true,
        isTaxRegistered: true,
        taxRegistrationType: true,
        taxRegistrationNumber: true,
        leadTimeDays: true,
        status: true,
        city: true,
        state: true,
        country: true,
        createdAt: true,
          notes: true,
      },
    })

    if (!supplier[0]) {
      const response = NextResponse.json({ error: "Supplier not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", supplierId: id })
      return withRequestId(response, logContext.requestId)
    }
    const response = NextResponse.json({
      item: {
        ...supplier[0],
        createdAt: supplier[0].createdAt.toISOString(),
      },
    })
    logApiRequestSuccess(logContext, 200, { supplierId: id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update supplier." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handleDELETE(
  request: Request, actor: BusinessActor,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)
  const { tenantId } = actor

  try {
    const { id } = await params
    const linkedProducts = await prisma.inventoryProductSupplier.count({
      where: { supplierId: id, product: { tenantId } },
    })
    const linkedPurchases = await prisma.purchaseOrder.count({
      where: { supplierId: id, tenantId },
    })

    if (linkedProducts > 0 || linkedPurchases > 0) {
      await prisma.supplier.updateMany({
        where: { id, tenantId },
        data: { status: "INACTIVE" },
      })
    } else {
      await prisma.supplier.deleteMany({ where: { id, tenantId } })
    }

    const response = NextResponse.json({ ok: true })
    logApiRequestSuccess(logContext, 200, { supplierId: id, linkedProducts, linkedPurchases })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to delete supplier." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventorySuppliers", "edit", actor => handlePATCH(request, actor, context), id)
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return withInventoryApi(request, "inventorySuppliers", "archive", actor => handleDELETE(request, actor, context), id)
}
