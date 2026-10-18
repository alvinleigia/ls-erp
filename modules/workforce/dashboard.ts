import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import { canManageUsers, type Role } from "@/lib/permissions"
import type { BusinessActor } from "@/platform/policy"

export async function workforceDashboardData(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[]) {
  const { tenantId } = actor
  const canReadLeaves = canManageUsers(actor.role as Role) && moduleEnabled(flags, "leaves") && permits(actor, "leaveApprovals.read")
  const pendingLeaves = await (
    canReadLeaves ? tx.leaveRequest.count({
      where: {
        tenantId,
        status: "PENDING",
        ...(actor.role === "MANAGER" ? { staffProfile: { managerUserId: actor.userId, user: { role: "STAFF" as const } } } : {}),
      },
    }) : Promise.resolve(0)
  )
  return { visible: canReadLeaves, pendingLeaves }
}
