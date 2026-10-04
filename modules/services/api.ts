import type { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

type ServiceResource = "services" | "serviceCategories"
const findRecord = (resource: ServiceResource, tenantId: string, id: string) => resource === "services"
  ? prisma.service.findFirst({ where: { tenantId, id }, include: { defaultTaxes: true, packageItems: true } })
  : prisma.serviceCategory.findFirst({ where: { tenantId, id } })

// Catalog use is also enforced at booking/eligibility entry points.
export async function requireServicesAccess(actor: BusinessActor, action: PermissionAction = "read", db: Pick<Prisma.TransactionClient, "tenantModule"> = prisma) {
  if (!canManageUsers(actor.role as Role)) throw new BusinessError(403, "Services requires administrator or manager access.")
  await requireBusinessModule(db, actor.tenantId, "services")
  requirePermission(actor, `services.${action}`)
}

export function withServicesApi(request: Request, resource: ServiceResource, action: PermissionAction, handler: (actor: BusinessActor) => Promise<NextResponse>, id?: string) {
  return withBusinessApi(request, async actor => {
    if (!canManageUsers(actor.role as Role)) throw new BusinessError(403, "Services requires administrator or manager access.")
    await requireBusinessModule(prisma, actor.tenantId, "services")
    requirePermission(actor, `${resource}.${action}`)
    const before = id ? await findRecord(resource, actor.tenantId, id) : null
    if (id && !before) throw new BusinessError(404, "Service record not found.")
    if (action === "create" || action === "edit") {
      const input = await readJson(request.clone()) as Record<string, unknown> | null
      if (input?.status !== undefined && input.status !== (before?.status ?? "ACTIVE")) requirePermission(actor, `${resource}.archive`)
      if (resource === "services" && input?.categoryId !== undefined && input.categoryId !== (before as { categoryId?: string } | null)?.categoryId) requirePermission(actor, "serviceCategories.read")
    }
    const response = await handler(actor)
    if (response.ok && action !== "read") {
      const result = await response.clone().json()
      const entityId = id ?? result.item?.id
      const after = entityId ? await findRecord(resource, actor.tenantId, entityId) : null
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: `services.${resource}.${action}`, entityType: resource, entityId,
        ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}),
        ...(after ? { after: JSON.parse(JSON.stringify(after)) } : {}),
      })
    }
    return response
  })
}
