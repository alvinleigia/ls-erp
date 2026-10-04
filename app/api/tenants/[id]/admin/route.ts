import bcrypt from "bcryptjs"
import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { requirePlatformConsoleAccess } from "@/lib/platform-console"
import { prisma, runWithRlsBypassDbContext } from "@/lib/prisma"
import { updateTenantAdminSchema } from "@/lib/validation"

const PLATFORM_TENANT_SLUG = (
  process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
)

const findTenantAdmin = async (tenantId: string) =>
  prisma.user.findFirst({
    where: {
      tenantId,
      role: "ADMIN",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
  })

export async function GET(
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

  try {
    // Scope cross-tenant work explicitly after platform authorization.
    return await runWithRlsBypassDbContext(async () => {
      const { id } = await params
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          organization: { select: { id: true } },
        },
      })
      if (!tenant) {
        const response = NextResponse.json({ error: "Tenant not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "tenant_not_found", tenantId: id })
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

      const admin = await findTenantAdmin(tenant.id)
      if (!admin) {
        const response = NextResponse.json({ error: "Tenant admin user not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "tenant_admin_not_found", tenantId: id })
        return withRequestId(response, logContext.requestId)
      }

      const response = NextResponse.json({
        admin: {
          ...admin,
          createdAt: admin.createdAt.toISOString(),
          lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
        },
      })
      logApiRequestSuccess(logContext, 200, { tenantId: id, adminId: admin.id })
      return withRequestId(response, logContext.requestId)
    })
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load tenant admin." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

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

  const payload = await request.json().catch(() => null)
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }
  const parsed = updateTenantAdminSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    // Scope cross-tenant work explicitly after platform authorization.
    return await runWithRlsBypassDbContext(async () => {
      const { id } = await params
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          organization: { select: { id: true } },
        },
      })
      if (!tenant) {
        const response = NextResponse.json({ error: "Tenant not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "tenant_not_found", tenantId: id })
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

      const admin = await findTenantAdmin(tenant.id)
      if (!admin) {
        const response = NextResponse.json({ error: "Tenant admin user not found." }, { status: 404 })
        logApiRequestSuccess(logContext, 404, { reason: "tenant_admin_not_found", tenantId: id })
        return withRequestId(response, logContext.requestId)
      }

      const data = parsed.data
      const nextEmail = data.email?.trim().toLowerCase()
      if (nextEmail && nextEmail !== admin.email.toLowerCase()) {
        const existing = await prisma.user.findFirst({
          where: { email: nextEmail },
          select: { id: true },
        })
        if (existing && existing.id !== admin.id) {
          const response = NextResponse.json({ error: "Email already in use." }, { status: 409 })
          logApiRequestSuccess(logContext, 409, { reason: "duplicate_email", tenantId: id })
          return withRequestId(response, logContext.requestId)
        }
      }

      const passwordHash = data.password?.trim()
        ? await bcrypt.hash(data.password.trim(), 10)
        : undefined

      const updated = await prisma.user.update({
        where: { id: admin.id },
        data: {
          ...(data.name?.trim() ? { name: data.name.trim() } : {}),
          ...(nextEmail ? { email: nextEmail } : {}),
          ...(data.phone?.trim() ? { phone: data.phone.trim() } : data.phone === "" ? { phone: null } : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
        },
      })

      await recordDomainAuditEventSafe(prisma, {
        tenantId: actorTenantId,
        event: "tenant.admin.updated",
        entityType: "Tenant",
        entityId: tenant.id,
        actorUserId: sessionUserId,
        actorRole,
        requestId: logContext.requestId,
        before: {
          adminUserId: admin.id,
          name: admin.name,
          email: admin.email,
          phone: admin.phone,
          status: admin.status,
        },
        after: {
          adminUserId: updated.id,
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          status: updated.status,
        },
      })

      const response = NextResponse.json({
        admin: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
        },
      })
      logApiRequestSuccess(logContext, 200, { tenantId: id, adminId: updated.id })
      return withRequestId(response, logContext.requestId)
    })
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update tenant admin." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}
