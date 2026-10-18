import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { canManageUsers, type Role } from "@/lib/permissions"
import { requireBusinessModule } from "@/platform/module-server"
import { requirePermission } from "@/platform/access/policy"
import type { PermissionAction } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"

// Catalog use is also enforced at booking/eligibility entry points.
export async function requireServicesAccess(actor: BusinessActor, action: PermissionAction = "read", db: Pick<Prisma.TransactionClient, "tenantModule"> = prisma) {
  if (!canManageUsers(actor.role as Role)) throw new BusinessError(403, "Services requires administrator or manager access.")
  await requireBusinessModule(db, actor.tenantId, "services")
  requirePermission(actor, `services.${action}`)
}
