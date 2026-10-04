import { requireBusinessModule } from "@/platform/module-server"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { guardUserWrite, auditUserSecurity, assignInitialRole } from "@/platform/access/user-security"
import { BusinessError } from "@/platform/policy"
import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { Prisma } from "@prisma/client"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { createUserSchema } from "@/lib/validation"
import { canInvite, canManageUsers, type Role } from "@/lib/permissions"
import { withCoreApi, actorSession } from "@/platform/core/api"
import type { BusinessActor } from "@/platform/policy"

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  role: z.enum(["ADMIN", "MANAGER", "STAFF", "CUSTOMER"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "INVITED", "ARCHIVED"]).optional(),
  sortBy: z
    .enum(["createdAt", "name", "email", "phone", "role", "status", "lastLoginAt"])
    .optional(),
  sort: z
    .enum(["createdAt", "name", "email", "phone", "role", "status", "lastLoginAt"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  order: z.enum(["asc", "desc"]).optional(),
})

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context

  return runWithTenantDbContext(tenantId, async () => {
    if (!canManageUsers(role as Role)) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
      return withRequestId(response, logContext.requestId)
    }

    const url = new URL(request.url)
    const parsed = paginationSchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid pagination parameters." },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    try {
      const {
        page,
        pageSize,
        search,
        q,
        role: roleFilter,
        status,
        sortBy,
        sort,
        sortDir,
        order,
      } = parsed.data
      const skip = (page - 1) * pageSize
      const trimmedSearch = (q ?? search)?.trim()
      const resolvedSortBy = sort ?? sortBy
      const resolvedSortDir = order ?? sortDir

      const where = {
        tenantId,
        ...(roleFilter ? { role: roleFilter } : {}),
        ...(status ? { status } : {}),
        ...(trimmedSearch
          ? {
              OR: [
                { name: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
                { email: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
                { phone: { contains: trimmedSearch, mode: Prisma.QueryMode.insensitive } },
              ],
            }
          : {}),
      }

      const orderBy = resolvedSortBy
        ? { [resolvedSortBy]: resolvedSortDir }
        : { createdAt: "desc" as const }

      const [total, users] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            image: true,
            dateOfBirth: true,
            gender: true,
            status: true,
            lastLoginAt: true,
            marketingOptIn: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
            role: true,
            createdAt: true,
            staffProfile: {
              select: {
                schedulingMode: true,
              },
            },
          },
          where,
          orderBy,
          skip,
          take: pageSize,
        }),
      ])

      const totalPages = Math.max(1, Math.ceil(total / pageSize))

      const response = NextResponse.json({
        items: users,
        page,
        pageSize,
        total,
        totalPages,
      })
      logApiRequestSuccess(logContext, 200, { page, pageSize, total })
      return withRequestId(response, logContext.requestId)
    } catch (error) {
      logApiRequestError(logContext, error, 500)
      const response = NextResponse.json({ error: "Unable to load users." }, { status: 500 })
      return withRequestId(response, logContext.requestId)
    }
  })
}

async function handlePOST(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role, sessionUserId } = tenantSession.context

  return runWithTenantDbContext(tenantId, async () => {
    if (!canInvite(role as Role)) {
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

    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    const {
      name,
      email,
      password,
      role: userRole,
      phone,
      image,
      dateOfBirth,
      gender,
      status,
      eligibleServiceIds,
      marketingOptIn,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
    } = parsed.data

    try {
      const existing = await prisma.user.findFirst({ where: { email, tenantId } })
      if (existing) {
        const response = NextResponse.json(
          { error: "Email already in use." },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { reason: "email_in_use" })
        return withRequestId(response, logContext.requestId)
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const normalizedEligibleServiceIds =
        userRole === "STAFF" && eligibleServiceIds
          ? Array.from(new Set(eligibleServiceIds))
          : []

      const identity = { tenantId, userId: sessionUserId!, requestId: logContext.requestId }
      const user = await prisma.$transaction(async tx => {
        await guardUserWrite(tx, identity)
        if (normalizedEligibleServiceIds.length) {
          await requireBusinessModule(tx, tenantId, "services")
          const count = await tx.service.count({ where: { tenantId, id: { in: normalizedEligibleServiceIds } } })
          if (count !== normalizedEligibleServiceIds.length) throw new BusinessError(400, "One or more services were not found in this tenant.")
        }
        const created = await tx.user.create({
        data: {
          name: name || undefined,
          tenantId,
          email,
          passwordHash,
          role: userRole ?? "CUSTOMER",
          phone: phone || undefined,
          image: image || undefined,
          dateOfBirth,
          gender,
          status: status ?? "ACTIVE",
          marketingOptIn: userRole === "STAFF" ? false : marketingOptIn ?? false,
          addressLine1: addressLine1 || undefined,
          addressLine2: addressLine2 || undefined,
          city: city || undefined,
          state: state || undefined,
          postalCode: postalCode || undefined,
          country: country || undefined,
          eligibleServices: normalizedEligibleServiceIds.length
            ? {
                createMany: {
                  data: normalizedEligibleServiceIds.map((serviceId) => ({ serviceId })),
                },
              }
            : undefined,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          image: true,
          dateOfBirth: true,
          gender: true,
          status: true,
          lastLoginAt: true,
          marketingOptIn: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          role: true,
          createdAt: true,
          staffProfile: {
            select: {
              schedulingMode: true,
            },
          },
        },
      })

      await assignInitialRole(tx, identity, created, parsed.data.accessRoleId)
        if (normalizedEligibleServiceIds.length) await recordDomainAuditEvent(tx, { tenantId, actorUserId: sessionUserId, actorRole: "ADMIN", requestId: logContext.requestId, event: "services.eligibility.updated", entityType: "User", entityId: created.id, after: { serviceIds: normalizedEligibleServiceIds } })
        await auditUserSecurity(tx, identity, created.id, null, created)
        return created
      })

      const response = NextResponse.json({ user })
      logApiRequestSuccess(logContext, 200, { userId: user.id, role: user.role })
      return withRequestId(response, logContext.requestId)
    } catch (error) {
      if (error instanceof BusinessError) return withRequestId(NextResponse.json({ error: error.message }, { status: error.status }), logContext.requestId)
      logApiRequestError(logContext, error, 500)
      const response = NextResponse.json({ error: "Unable to create user." }, { status: 500 })
      return withRequestId(response, logContext.requestId)
    }
  })
}

export async function GET(request: Request) {
  return withCoreApi(request, "users", "read", actor => handleGET(request, actor))
}

export async function POST(request: Request) {
  return withCoreApi(request, "users", "create", actor => handlePOST(request, actor))
}
