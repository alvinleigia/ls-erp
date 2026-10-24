import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { recordLimits } from "@/platform/access/rules"

// Approval routing is employment data, independent of a user's account label
// or sales-team management. A reviewer cannot approve their own request.
export function leaveApprovalScope(actor: BusinessActor, action?: PermissionAction): Prisma.LeaveRequestWhereInput {
  if (actor.role === "ADMIN") return { tenantId: actor.tenantId }
  return { tenantId: actor.tenantId, staffProfile: {
    user: { tenantId: actor.tenantId }, userId: { not: actor.userId }, leaveApprovalMode: "REPORTING_MANAGER",
    AND: recordLimits(actor, "leaveApprovals", action).map(scope => scope === "NONE" ? { id: { in: [] } } : { managerUserId: actor.userId }),
  } }
}
