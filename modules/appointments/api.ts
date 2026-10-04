import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { recordDomainAuditEventSafe } from "@/lib/domain-audit"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

type Resource = "appointments" | "appointmentCoupons"
type RecordKind = "appointment" | "order" | "coupon"
const snapshot = (kind: RecordKind, tenantId: string, id: string) => kind === "coupon"
  ? prisma.coupon.findFirst({ where: { tenantId, id } })
  : kind === "order" ? prisma.appointmentOrder.findFirst({ where: { tenantId, id }, include: { lines: true, productLines: true, coupons: true } })
  : prisma.appointment.findFirst({ where: { tenantId, id } })

export async function requireAppointmentsAccess(actor: BusinessActor, action: PermissionAction = "read", resource: Resource = "appointments") {
  if (!canManageUsers(actor.role as Role)) throw new BusinessError(403, "Appointments requires administrator or manager access.")
  await requireBusinessModule(prisma, actor.tenantId, "appointments")
  requirePermission(actor, `${resource}.${action}`)
}

// Read authorization is required for every action by the shared permission policy.
// Cancellation/reactivation is distinct from ordinary booking edits.
export function withAppointmentsApi(request: Request, resource: Resource, action: PermissionAction,
  handler: (actor: BusinessActor) => Promise<NextResponse>, record?: { kind: RecordKind; id?: string }, event?: string) {
  return withBusinessApi(request, async actor => {
    await requireAppointmentsAccess(actor, action, resource)
    const before = record?.id ? await snapshot(record.kind, actor.tenantId, record.id) : null
    if (record?.id && !before) throw new BusinessError(404, "Appointment record not found.")
    if (action === "create" || action === "edit") {
      const input = await readJson(request.clone()) as Record<string, unknown> | null
      if (resource === "appointmentCoupons") {
        const active = before && "isActive" in before ? before.isActive : true
        // Eligibility arrays are not foreign keys: validate changed selections explicitly.
        for (const field of ["allowedServiceIds", "allowedCategoryIds", "allowedProductIds"] as const) {
          const ids = input?.[field]
          const old = before && "allowedServiceIds" in before ? before[field] : []
          if (!Array.isArray(ids) || !ids.every(id => typeof id === "string") || JSON.stringify(ids) === JSON.stringify(old)) continue
          if (field === "allowedProductIds") {
            await requireBusinessModule(prisma, actor.tenantId, "inventory")
            requirePermission(actor, "inventoryProducts.read")
          } else {
            await requireBusinessModule(prisma, actor.tenantId, "services")
            requirePermission(actor, field === "allowedServiceIds" ? "services.read" : "serviceCategories.read")
          }
          const where = { tenantId: actor.tenantId, id: { in: ids } }
          const count = field === "allowedProductIds" ? await prisma.inventoryProduct.count({ where }) : field === "allowedServiceIds" ? await prisma.service.count({ where }) : await prisma.serviceCategory.count({ where })
          if (count !== new Set(ids).size) throw new BusinessError(400, "Coupon eligibility includes unavailable records.")
        }
        if (input?.isActive !== undefined && input.isActive !== active) requirePermission(actor, "appointmentCoupons.archive")
      } else {
        const status = before && "status" in before ? before.status : undefined
        if (input?.status !== undefined && input.status !== status && (input.status === "CANCELED" || status === "CANCELED")) requirePermission(actor, "appointments.archive")
      }
    }
    const response = await handler(actor)
    if (response.ok && record && action !== "read") {
      const result = response.headers.get("content-type")?.includes("application/json") ? await response.clone().json() : null
      const id = record.id ?? result?.order?.id ?? result?.coupon?.id
      const after = id ? await snapshot(record.kind, actor.tenantId, id) : null
      await recordDomainAuditEventSafe(prisma, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        event: event ?? `appointments.${record.kind}.${action}`, entityType: record.kind, entityId: id,
        ...(before ? { before: JSON.parse(JSON.stringify(before)) } : {}),
        ...(after ? { after: JSON.parse(JSON.stringify(after)) } : {}),
      })
    }
    return response
  })
}
