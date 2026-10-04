import { withInventoryApi } from "@/modules/inventory/api"
import type { BusinessActor } from "@/platform/policy"
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
import { createSupplierSchema, supplierStatusSchema } from "@/lib/validation"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "name", "status"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  q: z.string().trim().optional(),
  status: supplierStatusSchema.optional(),
})


async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  const url = new URL(request.url)
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid pagination parameters.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const { page, pageSize, sort, order, q, status } = parsed.data
    const skip = (page - 1) * pageSize
    const orderBy = sort
      ? { [sort]: order ?? "asc" }
      : { name: "asc" as const }

    const where: Prisma.SupplierWhereInput = {
      tenantId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { contactPerson: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
    }

    const [total, items] = await prisma.$transaction([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
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
      }),
    ])

    const response = NextResponse.json({
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
    logApiRequestSuccess(logContext, 200, { page, pageSize, total })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load suppliers." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { tenantId } = actor

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = createSupplierSchema.safeParse(body)
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
    const supplier = await prisma.supplier.create({
      data: {
        tenantId,
        name: data.name.trim(),
        contactPerson: data.contactPerson?.trim() || undefined,
        email: data.email?.trim() || undefined,
        phone: data.phone?.trim() || undefined,
        isTaxRegistered: data.isTaxRegistered ?? false,
        taxRegistrationType: data.isTaxRegistered ? data.taxRegistrationType : null,
        taxRegistrationNumber: data.isTaxRegistered
          ? data.taxRegistrationNumber?.trim() || undefined
          : undefined,
        leadTimeDays: data.leadTimeDays ?? 0,
        addressLine1: data.addressLine1?.trim() || undefined,
        addressLine2: data.addressLine2?.trim() || undefined,
        city: data.city?.trim() || undefined,
        state: data.state?.trim() || undefined,
        postalCode: data.postalCode?.trim() || undefined,
        country: data.country?.trim() || undefined,
        notes: data.notes?.trim() || undefined,
        status: data.status ?? "ACTIVE",
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

    const response = NextResponse.json(
      {
        item: {
          ...supplier,
          createdAt: supplier.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
    logApiRequestSuccess(logContext, 201, { supplierId: supplier.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to create supplier." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withInventoryApi(request, "inventorySuppliers", "read", actor => handleGET(request, actor))
}

export async function POST(request: Request) {
  return withInventoryApi(request, "inventorySuppliers", "create", actor => handlePOST(request, actor))
}
