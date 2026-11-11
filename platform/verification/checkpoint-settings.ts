import { createHash } from "node:crypto"
import type { PrismaClient, Prisma } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import type { VerificationIdentity } from "./configuration"
import { checkpointInputSchema, checkpointPublishSchema, checkpointDefinitionSchema, emptyCheckpoints } from "./checkpoint-contracts"
export function createVerificationCheckpointSettings(db: PrismaClient, identity: VerificationIdentity) {
  const current = async (tx: Prisma.TransactionClient, actor: BusinessActor) => {
    const row = await tx.verificationCheckpointVersion.findFirst({ where: { tenantId: actor.tenantId }, orderBy: { version: "desc" } })
    return { version: row?.version ?? 0, definition: row ? checkpointDefinitionSchema.parse(row.definition) : emptyCheckpoints(), canPublish: actor.role === "ADMIN" }
  }
  async function run<T>(write: boolean, fn: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) { await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`; await lockTenantOperations(tx, identity.tenantId) }
      const actor = await authorizeBusinessOperation(tx, identity, write ? ["verificationCheckpoints.read", "verificationCheckpoints.edit"] : "verificationCheckpoints.read", ["customerVerification"])
      if (actor.collaboratorId || write && actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must publish verification checkpoints.")
      return fn(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
  }
  async function prepare(tx: Prisma.TransactionClient, actor: BusinessActor, input: unknown) {
    const data = checkpointInputSchema.parse(input), saved = await current(tx, actor)
    if (data.version !== saved.version) throw new BusinessError(409, "Checkpoint settings changed. Reload before publishing.")
    if (Object.values(data.definition.checkpoints).some(mode => mode !== "OFF")) {
      const [p] = await tx.$queryRaw<{ version: number | null }[]>`SELECT app.verification_latest_version(${actor.tenantId}) AS version`
      if (!p?.version) throw new BusinessError(409, "Publish verification requirements before enabling checkpoints.")
    }
    return { data, previewHash: createHash("sha256").update(JSON.stringify({ tenantId: actor.tenantId, ...data })).digest("hex") }
  }
  return {
    get: () => run(false, current),
    preview: (input: unknown) => run(true, (tx, actor) => prepare(tx, actor, input)),
    publish: (input: unknown) => run(true, async (tx, actor) => {
      const { previewHash, ...inputData } = checkpointPublishSchema.parse(input), checked = await prepare(tx, actor, inputData)
      if (checked.previewHash !== previewHash) throw new BusinessError(409, "Checkpoint draft changed. Preview again before publishing.")
      const version = checked.data.version + 1
      await tx.verificationCheckpointVersion.create({ data: { tenantId: actor.tenantId, version, definition: checked.data.definition, publishedByUserId: actor.userId } })
      await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, event: "customerVerification.checkpointsPublished", entityType: "VerificationCheckpointVersion", entityId: actor.tenantId, requestId: actor.requestId, after: { version, checkpoints: checked.data.definition.checkpoints } })
      return { version, definition: checked.data.definition, canPublish: true }
    }),
  }
}
