import type { Prisma, PrismaClient } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "../policy"
import { activeTerms, cleanLabel, defaultTerm, resolveTermLabels, termReplacements, validateTermLabels, type Term } from "./catalog"
import { terminologyUpdateSchema } from "./validation"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
export type TerminologySnapshot = {
  version: number; canManage: boolean; labels: Record<string, string>; replacements: Record<string, string>
  terms: { key: string; section: string; defaultLabel: string; label: string; override: string | null }[]
}

export function createTerminologyService(db: PrismaClient, identity: Identity, catalog: readonly Term[]) {
  async function identityCheck(tx: Prisma.TransactionClient, write: boolean) {
    const user = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: identity.userId, status: "ACTIVE" }, select: { role: true, tenant: { select: { status: true, slug: true } } } })
    if (!user || !hasBusinessAccess(user.role) || user.tenant?.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Business workspace access is not permitted.")
    if (write && user.role !== "ADMIN") throw new BusinessError(403, "Only a business administrator can change terminology.")
    return user
  }
  async function state(tx: Prisma.TransactionClient) {
    const [revision, rows, flags] = await Promise.all([
      tx.tenantTerminologyRevision.findUnique({ where: { tenantId: identity.tenantId } }),
      tx.tenantTerminology.findMany({ where: { tenantId: identity.tenantId }, orderBy: { key: "asc" } }),
      tx.tenantModule.findMany({ where: { tenantId: identity.tenantId }, select: { key: true, enabled: true, allowed: true } }),
    ])
    return { version: revision?.version ?? 0, overrides: Object.fromEntries(rows.map(row => [row.key, row.label])), available: activeTerms(catalog, flags) }
  }
  function snapshot(current: Awaited<ReturnType<typeof state>>, role: string): TerminologySnapshot {
    const labels = resolveTermLabels(current.available, current.overrides)
    return { version: current.version, canManage: role === "ADMIN", labels, replacements: termReplacements(current.available, current.overrides),
      terms: current.available.map(term => ({ key: term.key, section: term.section, defaultLabel: defaultTerm(term), label: labels[term.key], override: current.overrides[term.key] ?? null })) }
  }
  return {
    read() {
      // One tenant snapshot per request, without a process-wide tenant cache.
      return db.$transaction(async tx => {
        const user = await identityCheck(tx, false)
        return snapshot(await state(tx), user.role)
      }, { isolationLevel: "RepeatableRead" })
    },
    async update(input: unknown) {
      const data = terminologyUpdateSchema.parse(input)
      if (new Set(data.changes.map(change => change.key)).size !== data.changes.length) throw new BusinessError(400, "Each label can only be changed once.")
      for (let attempt = 0; ; attempt++) {
        try { return await db.$transaction(async tx => {
          // Serialize with module changes. ReadCommitted obtains fresh authorization
          // after waiting for this lock, rather than retaining a pre-wait snapshot.
          await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
          const user = await identityCheck(tx, true), before = await state(tx)
          if (data.version !== before.version) throw new BusinessError(409, "Terminology changed. Refresh before saving.")
          const next = { ...before.overrides }
          for (const change of data.changes) {
            const term = before.available.find(term => term.key === change.key)
            if (!term) throw new BusinessError(403, "This label is unavailable for this business.")
            const label = change.label === null ? null : cleanLabel(change.label)
            if (label === null || label === defaultTerm(term)) delete next[change.key]
            else next[change.key] = label
          }
          validateTermLabels(catalog, next)
          const changes = data.changes.filter(change => next[change.key] !== before.overrides[change.key])
          if (!changes.length) return snapshot(before, user.role)
          for (const change of changes) {
            const label = next[change.key]
            if (label === undefined) await tx.tenantTerminology.deleteMany({ where: { tenantId: identity.tenantId, key: change.key } })
            else await tx.tenantTerminology.upsert({ where: { tenantId_key: { tenantId: identity.tenantId, key: change.key } }, create: { tenantId: identity.tenantId, key: change.key, label }, update: { label } })
          }
          const revision = await tx.tenantTerminologyRevision.upsert({ where: { tenantId: identity.tenantId }, create: { tenantId: identity.tenantId, version: 1 }, update: { version: { increment: 1 } } })
          await recordDomainAuditEvent(tx, { tenantId: identity.tenantId, actorUserId: identity.userId, actorRole: user.role, requestId: identity.requestId, event: "terminology.updated", entityType: "TenantTerminology", entityId: identity.tenantId,
            before: { version: before.version, labels: Object.fromEntries(changes.map(change => [change.key, before.overrides[change.key] ?? null])) },
            after: { version: revision.version, labels: Object.fromEntries(changes.map(change => [change.key, next[change.key] ?? null])) },
          })
          return snapshot({ ...before, version: revision.version, overrides: next }, user.role)
        }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 }) }
        catch (error) {
          if ((error as { code?: string }).code === "P2034" && attempt < 2) continue
          if ((error as { code?: string }).code === "P2034") throw new BusinessError(409, "Terminology changed. Refresh before saving.")
          throw error
        }
      }
    },
  }
}
