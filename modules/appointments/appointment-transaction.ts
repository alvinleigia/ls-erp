import type { Prisma } from "@prisma/client"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { requirePermission } from "@/platform/access/policy"
import { requireBusinessModule } from "@/platform/module-server"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { scheduleTransaction } from "@/modules/workforce/schedule-transaction"

export function appointmentTransaction<T>(actor: BusinessActor, action: "create" | "edit" | "archive",
  write: (tx: Prisma.TransactionClient, currentActor: BusinessActor) => Promise<T>, resource: "appointments" | "appointmentCoupons" = "appointments") {
  return scheduleTransaction(actor.tenantId, async tx => {
    const user = await findAccessUser(tx, actor.tenantId, actor.userId)
    if (!user || !["ADMIN", "MANAGER"].includes(user.role) || user.tenant.status !== "ACTIVE") {
      throw new BusinessError(403, "Appointment management access is no longer available.")
    }
    await requireBusinessModule(tx, actor.tenantId, "appointments")
    const current = { ...actor, role: user.role, permissions: assignedPermissions(user) }
    requirePermission(current, `${resource}.read`)
    requirePermission(current, `${resource}.${action}`)
    return write(tx, current)
  })
}
