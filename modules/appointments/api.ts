import type { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withBusinessApi, readJson } from "@/platform/business-api"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { type BusinessActor } from "@/platform/policy"

type Resource = "appointments" | "appointmentCoupons"
export async function requireAppointmentsAccess(actor: BusinessActor, action: PermissionAction = "read", resource: Resource = "appointments") {
  await requireBusinessModule(prisma, actor.tenantId, "appointments")
  requirePermission(actor, `${resource}.${action}`)
}

// Read authorization is required for every action by the shared permission policy.
// Cancellation/reactivation is distinct from ordinary booking edits.
export function withAppointmentsApi(request: Request, resource: Resource, action: PermissionAction,
  handler: (actor: BusinessActor) => Promise<NextResponse>) {
  return withBusinessApi(request, async actor => {
    await requireAppointmentsAccess(actor, action, resource)
    if (action === "create" || action === "edit") {
      const input = await readJson(request.clone()) as Record<string, unknown> | null
      if (resource === "appointments") {
        if (input?.status === "CANCELED") requirePermission(actor, "appointments.archive")
      }
    }
    return handler(actor)
  })
}
