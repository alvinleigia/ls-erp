import { leaveApprovalScope } from "./leave-access"
import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"

export async function workforceDashboardData(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[]) {
  const { tenantId } = actor
  const canReadLeaves = moduleEnabled(flags, "leaves") && permits(actor, "leaveApprovals.read")
  const pendingLeaves = await (
    canReadLeaves ? tx.leaveRequest.count({
      where: {
        tenantId,
        status: "PENDING",
        ...leaveApprovalScope(actor, "read"),
      },
    }) : Promise.resolve(0)
  )
  return { visible: canReadLeaves, pendingLeaves }
}
