import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { withCurrentAccountApi, readJson } from "../business-api"
import { requirePermission } from "../access/policy"
import { BusinessError, type BusinessActor } from "../policy"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import type { PermissionAction } from "../access/catalog"

type CoreResource = "dashboard" | "users" | "businessSettings" | "taxRates" | "invitations"
export function actorSession(actor: BusinessActor): { error?: NextResponse; context: { tenantId: string; sessionUserId: string; role: string } } {
  return { context: { tenantId: actor.tenantId, sessionUserId: actor.userId, role: actor.role } }
}
export function withCoreApi(request: Request, resource: CoreResource, action: PermissionAction,
  handler: (actor: BusinessActor) => Promise<NextResponse>, id?: string) {
  return withCurrentAccountApi(request, async actor => {
    const own = resource === "users" && id === actor.userId
    if (!own) {
      if (resource !== "dashboard" && !canManageUsers(actor.role as Role)) throw new BusinessError(403, "Management access is required.")
      if (actor.role === "CUSTOMER") throw new BusinessError(403, "Business access is required.")
      if (resource === "invitations" || (resource === "users" && action !== "read")) {
        if (actor.role !== "ADMIN") throw new BusinessError(403, "Administrator access is required.")
      } else requirePermission(actor, `${resource}.${action}`)
    }
    const before = resource === "taxRates" && id ? await prisma.tax.findFirst({ where: { id, tenantId: actor.tenantId } })
      : resource === "businessSettings" && action !== "read" ? await prisma.appSetting.findUnique({ where: { tenantId: actor.tenantId }, include: { workingDays: { include: { periods: true } }, overrides: { include: { periods: true } } } }) : null
    if (resource === "taxRates" && id && !before) throw new BusinessError(404, "Tax not found.")
    if (resource === "taxRates" && ["create", "edit"].includes(action)) {
      const input = await readJson(request.clone()) as { isActive?: boolean }
      if (input?.isActive !== undefined && input.isActive !== ((before as { isActive?: boolean } | null)?.isActive ?? true)) requirePermission(actor, "taxRates.archive")
    }
    const response = await handler(actor)
    if (response.ok && action !== "read" && ["taxRates", "businessSettings"].includes(resource)) {
      const result = await response.clone().json()
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: `core.${resource}.${action}`, entityType: resource, entityId: id ?? result.tax?.id ?? result.settings?.id,
        before: before ? JSON.parse(JSON.stringify(before)) : undefined,
        after: JSON.parse(JSON.stringify(result.tax ?? result.settings ?? { deleted: true })),
      })
    }
    return response
  })
}
