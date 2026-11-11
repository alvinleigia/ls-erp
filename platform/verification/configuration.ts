import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { permits } from "@/platform/access/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { emptyVerificationPolicy, verificationPolicySchema, verificationPolicyInputSchema, verificationPolicyPublishSchema, type VerificationConfiguration } from "./contracts"

export type VerificationIdentity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
export async function readVerificationConfiguration(tx: Prisma.TransactionClient, tenantId: string): Promise<VerificationConfiguration> {
  const row = await tx.verificationPolicyVersion.findFirst({ where: { tenantId }, orderBy: { version: "desc" }, select: { version: true, definition: true } })
  return { version: row?.version ?? 0, definition: row ? verificationPolicySchema.parse(row.definition) : emptyVerificationPolicy() }
}
export function createVerificationConfigurationService(db: PrismaClient, identity: VerificationIdentity) {
  async function run<T>(write: boolean, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
        await lockTenantOperations(tx, identity.tenantId)
      }
      const actor = await authorizeBusinessOperation(tx, identity, write ? ["verificationPolicies.read", "verificationPolicies.edit"] : "verificationPolicies.read", ["customerVerification"])
      if (actor.collaboratorId || write && actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must publish verification requirements.")
      return operation(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
  }
  async function prepare(tx: Prisma.TransactionClient, actor: BusinessActor, input: unknown) {
    const data = verificationPolicyInputSchema.parse(input)
    const current = await readVerificationConfiguration(tx, actor.tenantId)
    if (current.version !== data.version) throw new BusinessError(409, "Verification requirements changed. Reload before publishing.")
    // Definition only: never query or copy private customer facts into a policy preview.
    const previewHash = createHash("sha256").update(JSON.stringify({ tenantId: actor.tenantId, ...data })).digest("hex")
    return { data, current, previewHash }
  }
  return {
    get: () => run(false, async (tx, actor) => ({ ...await readVerificationConfiguration(tx, actor.tenantId), canPublish: actor.role === "ADMIN" && permits(actor, "verificationPolicies.edit") })),
    preview: (input: unknown) => run(true, async (tx, actor) => {
      const prepared = await prepare(tx, actor, input)
      return { previewHash: prepared.previewHash, version: prepared.current.version, facts: prepared.data.definition.facts.length, documents: prepared.data.definition.documents.length }
    }),
    publish: (input: unknown) => {
      const { previewHash, ...data } = verificationPolicyPublishSchema.parse(input)
      return run(true, async (tx, actor) => {
        const prepared = await prepare(tx, actor, data)
        if (previewHash !== prepared.previewHash) throw new BusinessError(409, "The verification draft changed. Preview again before publishing.")
        const version = data.version + 1
        await tx.verificationPolicyVersion.create({ data: { tenantId: actor.tenantId, version, definition: data.definition, publishedByUserId: actor.userId } })
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "verificationPolicy.published", entityType: "VerificationPolicyVersion", entityId: actor.tenantId, before: { version: data.version }, after: { version, factCount: data.definition.facts.length, documentCount: data.definition.documents.length } })
        return { version, definition: data.definition, canPublish: true }
      })
    },
  }
}
