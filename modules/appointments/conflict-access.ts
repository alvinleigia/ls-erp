import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { moduleEnabled } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import { canManageUsers, type Role } from "@/lib/permissions"

// Conflict integrity is always enforced. Only authorized users see booking details.
export function canReadAppointmentDetails(tenantId: string, userId?: string | null) {
  return runWithTenantDbContext(tenantId, async () => {
    if (!userId) return false
    const [user, flags] = await Promise.all([
      findAccessUser(prisma, tenantId, userId),
      prisma.tenantModule.findMany({ where: { tenantId }, select: { key: true, allowed: true, enabled: true } }),
    ])
    return !!user && user.tenant.status === "ACTIVE" && canManageUsers(user.role as Role) && moduleEnabled(flags, "appointments") && permits({ permissions: assignedPermissions(user) }, "appointments.read")
  })
}
