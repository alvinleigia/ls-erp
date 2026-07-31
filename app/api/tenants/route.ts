import bcrypt from "bcryptjs"
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
import { requirePlatformConsoleAccess } from "@/lib/platform-console"
import { prisma } from "@/lib/prisma"
import { isManagedTenantHostname, normalizeHostname } from "@/lib/tenancy"
import { createTenantSchema } from "@/lib/validation"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { ensureVercelProjectDomain } from "@/lib/vercel-domains"
import type { ListResponse } from "@/types/api"

const PLATFORM_TENANT_SLUG = (
  process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
)
const LEGACY_DEFAULT_TENANT_SLUG = "default"

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
})

export async function GET(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await requirePlatformConsoleAccess(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_platform_scope_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }

  const parsed = listSchema.safeParse(
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

  try {
    const { page, pageSize, q, status } = parsed.data
    const andConditions: Prisma.TenantWhereInput[] = [{
      slug: { notIn: [PLATFORM_TENANT_SLUG, LEGACY_DEFAULT_TENANT_SLUG] },
    }]
    if (status) andConditions.push({ status })
    if (q) {
      andConditions.push({
        OR: [
          { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { slug: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { organization: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
          { domains: { some: { hostname: { contains: q, mode: Prisma.QueryMode.insensitive } } } },
        ],
      })
    }
    const where: Prisma.TenantWhereInput = { AND: andConditions }
    if (authorized.context.mode === "ORG_MEMBER") {
      where.organizationId = { in: authorized.context.organizationIds }
    }
    const skip = (page - 1) * pageSize

    const [total, items] = await prisma.$transaction([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
          domains: {
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { hostname: true },
          },
          _count: { select: { users: true } },
        },
      }),
    ])

    const response: ListResponse<{
      id: string
      name: string
      slug: string
      status: "ACTIVE" | "SUSPENDED" | "ARCHIVED"
      userCount: number
      organizationId: string | null
      organizationName: string | null
      customDomain: string | null
      createdAt: string
    }> = {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        status: item.status,
        userCount: item._count.users,
        organizationId: item.organization?.id ?? null,
        organizationName: item.organization?.name ?? null,
        customDomain: item.domains[0]?.hostname ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
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
    const response = NextResponse.json({ error: "Unable to load tenants." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function POST(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await requirePlatformConsoleAccess(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_platform_scope_failed" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId: actorTenantId, role: actorRole, sessionUserId } = authorized.context

  const payload = await request.json().catch(() => null)
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }

  const parsed = createTenantSchema.safeParse(payload)
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
    const normalizedSlug = data.slug.trim().toLowerCase()
    const normalizedAdminEmail = data.adminEmail.trim().toLowerCase()
    const normalizedOrganizationId = data.organizationId?.trim() ? data.organizationId.trim() : null
    const normalizedCustomDomain = data.customDomain
      ? normalizeHostname(data.customDomain)
      : null

    if (normalizedCustomDomain && isManagedTenantHostname(normalizedCustomDomain)) {
      const response = NextResponse.json(
        { error: "Custom domain must be outside the managed tenant root domain." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "custom_domain_conflicts_with_managed_root" })
      return withRequestId(response, logContext.requestId)
    }
    if (authorized.context.mode === "ORG_MEMBER") {
      if (!normalizedOrganizationId) {
        const response = NextResponse.json(
          { error: "Organization is required for parent-company tenant creation." },
          { status: 400 }
        )
        logApiRequestSuccess(logContext, 400, { reason: "organization_required_for_org_member" })
        return withRequestId(response, logContext.requestId)
      }
      if (!authorized.context.organizationIds.includes(normalizedOrganizationId)) {
        const response = NextResponse.json({ error: "Forbidden." }, { status: 403 })
        logApiRequestSuccess(logContext, 403, { reason: "organization_scope_failed" })
        return withRequestId(response, logContext.requestId)
      }
    }

    const [existingTenant, existingUser, existingDomain, organization] = await Promise.all([
      prisma.tenant.findUnique({ where: { slug: normalizedSlug }, select: { id: true } }),
      prisma.user.findFirst({ where: { email: normalizedAdminEmail }, select: { id: true } }),
      normalizedCustomDomain
        ? prisma.tenantDomain.findUnique({
            where: { hostname: normalizedCustomDomain },
            select: { id: true },
          })
        : Promise.resolve(null),
      normalizedOrganizationId
        ? prisma.organization.findUnique({
            where: { id: normalizedOrganizationId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ])
    if (existingTenant) {
      const response = NextResponse.json({ error: "Tenant slug already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "duplicate_tenant_slug" })
      return withRequestId(response, logContext.requestId)
    }
    if (existingUser) {
      const response = NextResponse.json({ error: "Admin email already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "duplicate_admin_email" })
      return withRequestId(response, logContext.requestId)
    }
    if (existingDomain) {
      const response = NextResponse.json({ error: "Custom domain already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "duplicate_custom_domain" })
      return withRequestId(response, logContext.requestId)
    }
    if (normalizedOrganizationId && !organization) {
      const response = NextResponse.json({ error: "Organization not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "organization_not_found" })
      return withRequestId(response, logContext.requestId)
    }

    let vercelDomainResult = null
    if (normalizedCustomDomain) {
      try {
        vercelDomainResult = await ensureVercelProjectDomain(normalizedCustomDomain)
      } catch (error) {
        const response = NextResponse.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unable to add custom domain to Vercel project.",
          },
          { status: 502 }
        )
        logApiRequestSuccess(logContext, 502, { reason: "vercel_domain_add_failed" })
        return withRequestId(response, logContext.requestId)
      }
    }

    const adminPasswordHash = await bcrypt.hash(data.adminPassword, 10)

    const created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name.trim(),
          slug: normalizedSlug,
          organizationId: normalizedOrganizationId,
          status: "ACTIVE",
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: data.adminName.trim(),
          email: normalizedAdminEmail,
          role: "ADMIN",
          status: "ACTIVE",
          passwordHash: adminPasswordHash,
        },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      })

      // Ensure baseline settings exist for the new tenant.
      await tx.appSetting.create({
        data: { tenantId: tenant.id },
      })

      if (normalizedCustomDomain) {
        await tx.tenantDomain.create({
          data: {
            tenantId: tenant.id,
            hostname: normalizedCustomDomain,
          },
        })
      }

      return { tenant, admin }
    })
    await recordDomainAuditEventSafe(prisma, {
      tenantId: actorTenantId,
      event: "tenant.created",
      entityType: "Tenant",
      entityId: created.tenant.id,
      actorUserId: sessionUserId,
      actorRole,
      requestId: logContext.requestId,
      metadata: {
        tenantSlug: created.tenant.slug,
        adminUserId: created.admin.id,
        adminEmail: created.admin.email,
        adminRole: created.admin.role,
        organizationId: normalizedOrganizationId,
        organizationName: organization?.name ?? null,
        customDomain: normalizedCustomDomain,
        vercelDomain: vercelDomainResult,
      },
      after: {
        name: created.tenant.name,
        slug: created.tenant.slug,
        status: created.tenant.status,
        organizationId: created.tenant.organization?.id ?? null,
        organizationName: created.tenant.organization?.name ?? null,
        customDomain: normalizedCustomDomain,
      },
    })

    const response = NextResponse.json(
      {
        tenant: {
          id: created.tenant.id,
          name: created.tenant.name,
          slug: created.tenant.slug,
          status: created.tenant.status,
          organizationId: created.tenant.organization?.id ?? null,
          organizationName: created.tenant.organization?.name ?? null,
          customDomain: normalizedCustomDomain,
          createdAt: created.tenant.createdAt.toISOString(),
        },
        admin: {
          id: created.admin.id,
          name: created.admin.name,
          email: created.admin.email,
          role: created.admin.role,
          createdAt: created.admin.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
    logApiRequestSuccess(logContext, 201, { tenantSlug: created.tenant.slug, adminId: created.admin.id })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const response = NextResponse.json({ error: "Duplicate tenant or admin data." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "p2002_conflict" })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to provision tenant." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}
