import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { BusinessError, type BusinessActor } from "./policy"

const schema = z.object({ key: z.enum(["crm", "realEstate"]), enabled: z.boolean() }).strict()
export async function updateBusinessModule(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId" | "requestId">, input: unknown) {
  const data = schema.parse(input)
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const user = await tx.user.findFirst({ where: { id: identity.userId, tenantId: identity.tenantId, status: "ACTIVE", role: "ADMIN" }, include: { tenant: true } })
        if (!user || user.tenant?.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Only an active business administrator can change modules.")
        const flags = await tx.tenantModule.findMany({ where: { tenantId: identity.tenantId } })
        const enabled = (key: string) => !!flags.find(row => row.key === key)?.enabled
        if (data.key === "realEstate" && data.enabled && !enabled("crm")) throw new BusinessError(409, "Enable CRM before enabling Real Estate.")
        if (data.key === "crm" && !data.enabled && enabled("realEstate")) throw new BusinessError(409, "Disable Real Estate before disabling CRM.")
        // Both dependency-changing operations contend on the CRM flag. This
        // makes a racing toggle fail at its write and retry with fresh flags,
        // rather than allowing disjoint writes to reach a commit-time conflict.
        if (data.key === "realEstate") await tx.tenantModule.updateMany({ where: { tenantId: identity.tenantId, key: "crm" }, data: { enabled: enabled("crm") } })
        const result = await tx.tenantModule.upsert({ where: { tenantId_key: { tenantId: identity.tenantId, key: data.key } }, create: { tenantId: identity.tenantId, ...data }, update: { enabled: data.enabled } })
        await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: user.role, entityType: "TenantModule", entityId: data.key, event: "module.updated", before: { enabled: enabled(data.key) }, after: { enabled: data.enabled } })
        return result
      }, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 })
    } catch (error) {
      const code = (error as { code?: string }).code
      if ((code === "P2034" || code === "P2002") && attempt < 2) continue
      if (code === "P2034" || code === "P2002") throw new BusinessError(409, "Module settings changed. Refresh and try again.")
      throw error
    }
  }
}
