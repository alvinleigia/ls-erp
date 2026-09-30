import type { Prisma, PrismaClient } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { BusinessError, type BusinessActor } from "./policy"
import { businessModules, moduleKeys, moduleChangeProblem, moduleAllowanceProblem, moduleEnabled, moduleSettings } from "./modules"
import { moduleAllowanceSchema, moduleToggleSchema, tenantModuleSelection } from "./module-validation"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
const platformSlug = () => process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"

async function moduleTransaction<T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: "Serializable", maxWait: 20000, timeout: 20000 }) }
    catch (error) {
      const code = (error as { code?: string }).code
      if ((code === "P2034" || code === "P2002") && attempt < 2) continue
      if (code === "P2034" || code === "P2002") throw new BusinessError(409, "Module settings changed. Refresh and try again.")
      throw error
    }
  }
}

async function admin(tx: Prisma.TransactionClient, identity: Identity, platform: boolean) {
  const user = await tx.user.findFirst({
    where: { id: identity.userId, tenantId: identity.tenantId, status: "ACTIVE", role: "ADMIN" },
    select: { role: true, tenant: { select: { status: true, slug: true } } },
  })
  if (!user || user.tenant?.status !== "ACTIVE" || (user.tenant.slug === platformSlug()) !== platform)
    throw new BusinessError(403, platform ? "Only an active platform administrator can allow modules." : "Only an active business administrator can change modules.")
  return user
}

// Both layers lock the same tenant row, serializing dependency changes.
async function lockTenant(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`
}

export async function updateBusinessModule(db: PrismaClient, identity: Identity, input: unknown) {
  const data = moduleToggleSchema.parse(input)
  return moduleTransaction(db, async tx => {
    const user = await admin(tx, identity, false)
    await lockTenant(tx, identity.tenantId)
    const flags = await tx.tenantModule.findMany({ where: { tenantId: identity.tenantId } })
    const previous = flags.find(row => row.key === data.key)
    if (!previous?.allowed) throw new BusinessError(403, "This module has not been allowed by the platform administrator.")
    const problem = moduleChangeProblem(flags, data.key, data.enabled)
    if (problem) throw new BusinessError(409, problem)
    if (previous.enabled === data.enabled) return previous
    const result = await tx.tenantModule.update({ where: { tenantId_key: { tenantId: identity.tenantId, key: data.key } }, data: { enabled: data.enabled } })
    await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: user.role, entityType: "TenantModule", entityId: data.key, event: "module.updated", before: { allowed: true, enabled: previous.enabled }, after: { allowed: true, enabled: data.enabled } })
    return result
  })
}

async function platformTarget(tx: Prisma.TransactionClient, identity: Identity, tenantId: string) {
  await admin(tx, identity, true)
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true } })
  if (!tenant || tenant.slug === platformSlug()) throw new BusinessError(404, "Business tenant not found.")
  return tenant
}

// Call only inside the authorized platform route's explicit RLS bypass context.
export function getTenantModules(db: PrismaClient, identity: Identity, tenantId: string) {
  return moduleTransaction(db, async tx => {
    const tenant = await platformTarget(tx, identity, tenantId)
    return { tenant, modules: moduleSettings(await tx.tenantModule.findMany({ where: { tenantId } })) }
  })
}

export function updateTenantModuleAllowance(db: PrismaClient, identity: Identity, tenantId: string, input: unknown) {
  const data = moduleAllowanceSchema.parse(input)
  return moduleTransaction(db, async tx => {
    await platformTarget(tx, identity, tenantId)
    await lockTenant(tx, tenantId)
    const flags = await tx.tenantModule.findMany({ where: { tenantId } })
    const previous = flags.find(row => row.key === data.key)
    const problem = moduleAllowanceProblem(flags, data.key, data.allowed)
    if (problem) throw new BusinessError(409, problem)
    if (!!previous?.allowed !== data.allowed) {
      const enabled = data.allowed && businessModules[data.key].requires.every(key => moduleEnabled(flags, key))
      await tx.tenantModule.upsert({ where: { tenantId_key: { tenantId, key: data.key } }, create: { tenantId, key: data.key, allowed: data.allowed, enabled }, update: { allowed: data.allowed, enabled } })
      await recordDomainAuditEvent(tx, {
        tenantId, actorUserId: identity.userId, actorRole: "ADMIN", requestId: identity.requestId,
        event: "module.allowance.updated", entityType: "TenantModule", entityId: data.key,
        metadata: { platformTenantId: identity.tenantId },
        before: { allowed: previous?.allowed ?? false, enabled: previous?.enabled ?? false }, after: { allowed: data.allowed, enabled },
      })
    }
    return { modules: moduleSettings(await tx.tenantModule.findMany({ where: { tenantId } })) }
  })
}

export async function provisionTenantModules(tx: Prisma.TransactionClient, identity: Identity, tenantId: string, input: unknown) {
  const selected = tenantModuleSelection.parse(input)
  if (selected.length) await admin(tx, identity, true)
  await tx.tenantModule.createMany({ data: moduleKeys.map(key => ({ tenantId, key, allowed: selected.includes(key), enabled: selected.includes(key) })) })
  if (selected.length) await recordDomainAuditEvent(tx, {
    tenantId, actorUserId: identity.userId, actorRole: "ADMIN", requestId: identity.requestId,
    event: "module.allowances.provisioned", entityType: "Tenant", entityId: tenantId,
    metadata: { platformTenantId: identity.tenantId }, after: { modules: [...selected] },
  })
}
