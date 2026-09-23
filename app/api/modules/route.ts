import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { businessModules } from "@/platform/modules"
import { readJson, withBusinessApi } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return withBusinessApi(request, async actor => {
    const configured = await prisma.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
    return {
      canManage: actor.role === "ADMIN",
      modules: Object.entries(businessModules).map(([key, module]) => ({
        key, ...module, enabled: configured.find(row => row.key === key)?.enabled ?? module.defaultEnabled,
      })),
    }
  })
}

export function PATCH(request: Request) {
  return withBusinessApi(request, async actor => {
    if (actor.role !== "ADMIN") throw new BusinessError(403, "Only a business administrator can change modules.")
    const data = z.object({ key: z.literal("crm"), enabled: z.boolean() }).strict().parse(await readJson(request))
    return prisma.$transaction(async tx => {
      const before = await tx.tenantModule.findUnique({ where: { tenantId_key: { tenantId: actor.tenantId, key: data.key } } })
      const enabledModule = await tx.tenantModule.upsert({
        where: { tenantId_key: { tenantId: actor.tenantId, key: data.key } },
        create: { tenantId: actor.tenantId, ...data }, update: { enabled: data.enabled },
      })
      await recordDomainAuditEvent(tx, {
        tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
        entityType: "TenantModule", entityId: data.key, event: "module.updated",
        before: { enabled: before?.enabled ?? false }, after: { enabled: data.enabled },
      })
      return enabledModule
    })
  })
}
