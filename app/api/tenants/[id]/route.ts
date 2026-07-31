import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

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
import { updateTenantStatusSchema } from "@/lib/validation"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { ensureVercelProjectDomain } from "@/lib/vercel-domains"

const PLATFORM_TENANT_SLUG = (
  process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
)

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await requirePlatformConsoleAccess(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, {
      reason: "unauthorized_or_platform_scope_failed",
    })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const { tenantId: actorTenantId, role: actorRole, sessionUserId } = authorized.context

  const { id } = await params
  const payload = await request.json().catch(() => null)
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json", tenantId: id })
    return withRequestId(response, logContext.requestId)
  }

  const parsed = updateTenantStatusSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed", tenantId: id })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
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
      },
    })
    if (!tenant) {
      const response = NextResponse.json({ error: "Tenant not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", tenantId: id })
      return withRequestId(response, logContext.requestId)
    }
    if (tenant.slug === PLATFORM_TENANT_SLUG) {
      const response = NextResponse.json(
        { error: "Platform tenant cannot be changed from this action." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "platform_tenant_restricted", tenantId: id })
      return withRequestId(response, logContext.requestId)
    }
    if (
      authorized.context.mode === "ORG_MEMBER" &&
      (!tenant.organization?.id ||
        !authorized.context.organizationIds.includes(tenant.organization.id))
    ) {
      const response = NextResponse.json({ error: "Forbidden." }, { status: 403 })
      logApiRequestSuccess(logContext, 403, { reason: "tenant_scope_failed", tenantId: id })
      return withRequestId(response, logContext.requestId)
    }

    const currentCustomDomain = tenant.domains[0]?.hostname ?? null
    const currentOrganizationId = tenant.organization?.id ?? null
    const currentOrganizationName = tenant.organization?.name ?? null
    const hasStatusChange = Boolean(parsed.data.status && tenant.status !== parsed.data.status)
    const normalizedOrganizationId =
      parsed.data.organizationId === undefined
        ? undefined
        : parsed.data.organizationId?.trim()
          ? parsed.data.organizationId.trim()
          : null
    const normalizedCustomDomain =
      parsed.data.customDomain === undefined
        ? undefined
        : parsed.data.customDomain
          ? normalizeHostname(parsed.data.customDomain)
          : null
    const hasOrganizationChange =
      normalizedOrganizationId !== undefined &&
      normalizedOrganizationId !== currentOrganizationId
    const hasCustomDomainChange =
      normalizedCustomDomain !== undefined && normalizedCustomDomain !== currentCustomDomain

    if (normalizedCustomDomain && isManagedTenantHostname(normalizedCustomDomain)) {
      const response = NextResponse.json(
        { error: "Custom domain must be outside the managed tenant root domain." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, {
        reason: "custom_domain_conflicts_with_managed_root",
        tenantId: id,
      })
      return withRequestId(response, logContext.requestId)
    }

    if (!hasStatusChange && !hasCustomDomainChange && !hasOrganizationChange) {
      const response = NextResponse.json(
        { error: "Tenant already has these values." },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "tenant_update_noop", tenantId: id })
      return withRequestId(response, logContext.requestId)
    }

    if (hasOrganizationChange) {
      if (authorized.context.mode !== "SUPER_ADMIN") {
        const response = NextResponse.json(
          { error: "Organization reassignment is restricted to platform super admins." },
          { status: 403 }
        )
        logApiRequestSuccess(logContext, 403, {
          reason: "organization_reassignment_requires_super_admin",
          tenantId: id,
        })
        return withRequestId(response, logContext.requestId)
      }
      if (normalizedOrganizationId) {
        const organization = await prisma.organization.findUnique({
          where: { id: normalizedOrganizationId },
          select: { id: true, name: true },
        })
        if (!organization) {
          const response = NextResponse.json({ error: "Organization not found." }, { status: 404 })
          logApiRequestSuccess(logContext, 404, { reason: "organization_not_found", tenantId: id })
          return withRequestId(response, logContext.requestId)
        }
      }
    }

    if (hasCustomDomainChange && normalizedCustomDomain) {
      const existingDomain = await prisma.tenantDomain.findUnique({
        where: { hostname: normalizedCustomDomain },
        select: { tenantId: true },
      })
      if (existingDomain && existingDomain.tenantId !== tenant.id) {
        const response = NextResponse.json({ error: "Custom domain already exists." }, { status: 409 })
        logApiRequestSuccess(logContext, 409, { reason: "duplicate_custom_domain", tenantId: id })
        return withRequestId(response, logContext.requestId)
      }
    }

    let vercelDomainResult = null
    if (hasCustomDomainChange && normalizedCustomDomain) {
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
        logApiRequestSuccess(logContext, 502, {
          reason: "vercel_domain_add_failed",
          tenantId: id,
        })
        return withRequestId(response, logContext.requestId)
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (hasStatusChange) {
        await tx.tenant.update({
          where: { id },
          data: {
            ...(parsed.data.status ? { status: parsed.data.status } : {}),
            ...(hasOrganizationChange ? { organizationId: normalizedOrganizationId } : {}),
          },
        })
      } else if (hasOrganizationChange) {
        await tx.tenant.update({
          where: { id },
          data: { organizationId: normalizedOrganizationId },
        })
      }

      if (hasCustomDomainChange) {
        await tx.tenantDomain.deleteMany({ where: { tenantId: id } })
        if (normalizedCustomDomain) {
          await tx.tenantDomain.create({
            data: {
              tenantId: id,
              hostname: normalizedCustomDomain,
            },
          })
        }
      }

      return tx.tenant.findUniqueOrThrow({
        where: { id },
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
      })
    })
    if (hasStatusChange) {
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actorTenantId,
        event: "tenant.status.updated",
        entityType: "Tenant",
        entityId: updated.id,
        actorUserId: sessionUserId,
        actorRole,
        requestId: logContext.requestId,
        before: {
          status: tenant.status,
        },
        after: {
          status: updated.status,
        },
      })
    }
    if (hasOrganizationChange) {
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actorTenantId,
        event: "tenant.organization.updated",
        entityType: "Tenant",
        entityId: updated.id,
        actorUserId: sessionUserId,
        actorRole,
        requestId: logContext.requestId,
        before: {
          organizationId: currentOrganizationId,
          organizationName: currentOrganizationName,
        },
        after: {
          organizationId: updated.organization?.id ?? null,
          organizationName: updated.organization?.name ?? null,
        },
      })
    }
    if (hasCustomDomainChange) {
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actorTenantId,
        event: "tenant.domain.updated",
        entityType: "Tenant",
        entityId: updated.id,
        actorUserId: sessionUserId,
        actorRole,
        requestId: logContext.requestId,
        before: {
          customDomain: currentCustomDomain,
        },
        after: {
          customDomain: updated.domains[0]?.hostname ?? null,
        },
        metadata: {
          vercelDomain: vercelDomainResult,
        },
      })
    }

    const response = NextResponse.json({
      tenant: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        status: updated.status,
        userCount: updated._count.users,
        organizationId: updated.organization?.id ?? null,
        organizationName: updated.organization?.name ?? null,
        customDomain: updated.domains[0]?.hostname ?? null,
        createdAt: updated.createdAt.toISOString(),
      },
    })
    logApiRequestSuccess(logContext, 200, {
      tenantId: id,
      previousStatus: tenant.status,
      nextStatus: updated.status,
      previousOrganizationId: currentOrganizationId,
      nextOrganizationId: updated.organization?.id ?? null,
      previousCustomDomain: currentCustomDomain,
      nextCustomDomain: updated.domains[0]?.hostname ?? null,
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const response = NextResponse.json({ error: "Custom domain already exists." }, { status: 409 })
      logApiRequestSuccess(logContext, 409, { reason: "p2002_conflict", tenantId: id })
      return withRequestId(response, logContext.requestId)
    }
    logApiRequestError(logContext, error, 500, { tenantId: id })
    const response = NextResponse.json({ error: "Unable to update tenant." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}
