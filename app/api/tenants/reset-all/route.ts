import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { canManageTenants, type Role } from "@/lib/permissions"
import { enterRlsBypassDbContext, prisma } from "@/lib/prisma"
import { requireTenantSession } from "@/lib/tenant-auth"
import { resetAllTenantsSchema } from "@/lib/validation"

const PLATFORM_TENANT_SLUG = (
  process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
)

const ensureProvisioningAccess = async (request: Request) => {
  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) return { error: tenantSession.error }
  if (!canManageTenants(tenantSession.context.role as Role)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const sessionTenant = await prisma.tenant.findFirst({
    where: { id: tenantSession.context.tenantId },
    select: { id: true, slug: true },
  })
  if (!sessionTenant || sessionTenant.slug !== PLATFORM_TENANT_SLUG) {
    return { error: NextResponse.json({ error: "Forbidden." }, { status: 403 }) }
  }

  enterRlsBypassDbContext()

  return { context: tenantSession.context }
}

const hardDeleteTenantData = async (tenantId: string) => {
  await prisma.$transaction(async (tx) => {
    // Cleanup restrictive Service dependencies using raw SQL so reset keeps working
    // even when Prisma model metadata and DB columns are temporarily out of sync.
    await tx.$executeRawUnsafe(
      `
      DELETE FROM "ServicePackageItem"
      WHERE "packageId" IN (SELECT "id" FROM "Service" WHERE "tenantId" = $1)
         OR "itemServiceId" IN (SELECT "id" FROM "Service" WHERE "tenantId" = $1)
      `,
      tenantId
    )

    await tx.$executeRawUnsafe(
      `
      DELETE FROM "AppointmentOrderLine"
      WHERE "serviceId" IN (SELECT "id" FROM "Service" WHERE "tenantId" = $1)
      `,
      tenantId
    )

    await tx.$executeRawUnsafe(
      `
      DELETE FROM "Appointment"
      WHERE "serviceId" IN (SELECT "id" FROM "Service" WHERE "tenantId" = $1)
      `,
      tenantId
    )

    await tx.$executeRawUnsafe(
      `
      DELETE FROM "StaffServiceEligibility"
      WHERE "serviceId" IN (SELECT "id" FROM "Service" WHERE "tenantId" = $1)
      `,
      tenantId
    )

    await tx.$executeRawUnsafe(
      `
      DELETE FROM "ServiceTax"
      WHERE "serviceId" IN (SELECT "id" FROM "Service" WHERE "tenantId" = $1)
      `,
      tenantId
    )

    await tx.tenantTerminology.deleteMany({ where: { tenantId } })
    await tx.realEstateUnit.deleteMany({ where: { tenantId } })
    await tx.catalogItem.deleteMany({ where: { tenantId } })
    await tx.tenantTerminologyRevision.deleteMany({ where: { tenantId } })
    await tx.tenant.delete({ where: { id: tenantId } })
  })
}

export async function POST(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureProvisioningAccess(request)
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

  const parsed = resetAllTenantsSchema.safeParse(payload)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    const [platformTenant, platformAdminUser] = await Promise.all([
      prisma.tenant.findUnique({
        where: { slug: PLATFORM_TENANT_SLUG },
        select: { id: true, slug: true },
      }),
      prisma.user.findFirst({
        where: {
          email: (process.env.PLATFORM_ADMIN_EMAIL ?? "").trim().toLowerCase(),
        },
        select: { id: true, email: true, tenantId: true },
      }),
    ])

    const keepPlatformTenant = parsed.data.keepPlatformTenant ?? true
    const preservedTenantIds = new Set<string>()
    if (keepPlatformTenant && platformTenant?.id) {
      preservedTenantIds.add(platformTenant.id)
    }
    if (platformAdminUser?.tenantId) {
      preservedTenantIds.add(platformAdminUser.tenantId)
    }
    if (preservedTenantIds.size === 0) {
      const response = NextResponse.json(
        {
          error:
            "No tenant could be preserved for platform admin. Check PLATFORM_ADMIN_EMAIL and platform tenant setup.",
        },
        { status: 409 }
      )
      logApiRequestSuccess(logContext, 409, { reason: "preserved_tenant_not_found" })
      return withRequestId(response, logContext.requestId)
    }

    const tenantsToDelete = await prisma.tenant.findMany({
      where: { id: { notIn: Array.from(preservedTenantIds) } },
      select: {
        id: true,
        slug: true,
        _count: { select: { users: true } },
      },
    })
    const keptTenants = await prisma.tenant.findMany({
      where: { id: { in: Array.from(preservedTenantIds) } },
      select: { id: true, slug: true },
    })
    const tenantIds = tenantsToDelete.map((tenant) => tenant.id)
    const deletedUsers = tenantsToDelete.reduce((sum, tenant) => sum + tenant._count.users, 0)

    if (tenantIds.length > 0) {
      for (const tenantId of tenantIds) {
        await hardDeleteTenantData(tenantId)
      }
    }

    await recordDomainAuditEventSafe(prisma, {
      tenantId: actorTenantId,
      event: "tenant.reset_all",
      entityType: "Tenant",
      actorUserId: sessionUserId,
      actorRole,
      requestId: logContext.requestId,
      metadata: {
        deletedTenantCount: tenantIds.length,
        deletedUserCount: deletedUsers,
        deletedTenantSlugs: tenantsToDelete.map((tenant) => tenant.slug),
        keepPlatformTenant,
        preservedTenantIds: Array.from(preservedTenantIds),
        preservedByPlatformAdminEmail: platformAdminUser?.email ?? null,
      },
    })

    const response = NextResponse.json({
      deletedTenantCount: tenantIds.length,
      deletedUserCount: deletedUsers,
      keptTenantSlugs: keptTenants.map((tenant) => tenant.slug),
      keptPlatformTenant: keepPlatformTenant,
      preservedPlatformAdminEmail: platformAdminUser?.email ?? null,
    })
    logApiRequestSuccess(logContext, 200, {
      deletedTenantCount: tenantIds.length,
      deletedUserCount: deletedUsers,
    })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to reset tenant data." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}
