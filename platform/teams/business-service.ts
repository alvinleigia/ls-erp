import { authorizeBusinessOperation } from "@/platform/access/operation"

import type { PrismaClient, Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"


import type { PermissionRun } from "@/platform/access/server"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { serializationConflict } from "@/platform/database-errors"
import { createTeamService } from "./service"

export function createBusinessTeamService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) {
  const run: PermissionRun = async (requirement, operation) => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.$transaction(async tx => {
          const actor = await authorizeBusinessOperation(tx, identity, requirement, [])
        return operation(tx, actor)
      }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 }) }
      catch (error) {
        if (serializationConflict(error) && attempt < 2) continue
        if (serializationConflict(error)) throw new BusinessError(409, "Team settings changed. Refresh before saving.")
        if ((error as { code?: string }).code === "P2002") throw new BusinessError(409, "A team with this name already exists.")
        throw error
      }
    }
  }
  return createTeamService({ run, audit: (tx, actor, event, id, before, after) => recordDomainAuditEvent(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: event.replace("crm.team.", "team."), entityType: "BusinessTeam", entityId: id, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue,
  }) })
}
