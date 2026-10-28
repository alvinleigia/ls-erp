import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { permits } from "@/platform/access/policy"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { defaultParticipantDefinition, genericParticipantPreset, participantFormDefinitionSchema, participantSettingsInputSchema, participantSettingsPublishSchema, type ParticipantFormConfiguration, type ParticipantFormDefinition, type ParticipantFormPreset } from "./requirements"

export type ParticipantPresetReader = (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<ParticipantFormPreset>
export async function readParticipantConfiguration(tx: Prisma.TransactionClient, tenantId: string, preset = genericParticipantPreset): Promise<ParticipantFormConfiguration> {
  const row = await tx.participantFormConfiguration.findUnique({ where: { tenantId } })
  return { version: row?.version ?? 0, definition: row ? participantFormDefinitionSchema.parse(row.definition) : defaultParticipantDefinition(preset), preset }
}
export type ParticipantImpact = { accessibleDrafts: number | null; incompleteDrafts: number | null }
type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
type Dependencies = { preset: ParticipantPresetReader; impact: (tx: Prisma.TransactionClient, actor: BusinessActor, definition: ParticipantFormDefinition) => Promise<ParticipantImpact> }
export function createParticipantConfigurationService(db: PrismaClient, identity: Identity, dependencies: Dependencies) {
  async function run<T>(write: boolean, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    return db.$transaction(async tx => {
      if (write) {
        // Both preview and publication stabilize the same draft population and
        // coordinate with security administration and commercial writers.
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
        await lockTenantOperations(tx, identity.tenantId)
      }
      const actor = await authorizeBusinessOperation(tx, identity, write ? ["participantSettings.read", "participantSettings.edit"] : "participantSettings.read")
      if (write && actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must publish customer detail requirements.")
      return operation(tx, actor)
    }, { isolationLevel: "ReadCommitted", maxWait: 20000, timeout: 20000 })
  }
  async function prepare(tx: Prisma.TransactionClient, actor: BusinessActor, input: unknown) {
    const data = participantSettingsInputSchema.parse(input)
    const configuration = await readParticipantConfiguration(tx, actor.tenantId, await dependencies.preset(tx, actor))
    if (configuration.version !== data.version) throw new BusinessError(409, "Customer detail settings changed. Reload before publishing.")
    const impact = await dependencies.impact(tx, actor, data.definition)
    const previewHash = createHash("sha256").update(JSON.stringify({ ...data, impact, preset: configuration.preset })).digest("hex")
    return { data, configuration, impact, previewHash }
  }
  return {
    get() { return run(false, async (tx, actor) => ({ ...await readParticipantConfiguration(tx, actor.tenantId, await dependencies.preset(tx, actor)), canPublish: actor.role === "ADMIN" && permits(actor, "participantSettings.edit") })) },
    preview(input: unknown) { return run(true, async (tx, actor) => { const { impact, previewHash } = await prepare(tx, actor, input); return { impact, previewHash } }) },
    publish(input: unknown) {
      const { previewHash, ...data } = participantSettingsPublishSchema.parse(input)
      return run(true, async (tx, actor) => {
        const prepared = await prepare(tx, actor, data)
        if (prepared.previewHash !== previewHash) throw new BusinessError(409, "The draft impact changed. Preview again before publishing; your settings have not been saved.")
        const version = data.version + 1
        if (data.version === 0) await tx.participantFormConfiguration.create({ data: { tenantId: actor.tenantId, version, definition: data.definition } })
        else {
          const updated = await tx.participantFormConfiguration.updateMany({ where: { tenantId: actor.tenantId, version: data.version }, data: { version, definition: data.definition } })
          if (!updated.count) throw new BusinessError(409, "Customer detail settings changed. Reload before publishing.")
        }
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "participantSettings.published", entityType: "ParticipantFormConfiguration", entityId: actor.tenantId, before: { version: prepared.configuration.version, definition: prepared.configuration.definition }, after: { version, definition: data.definition, impact: prepared.impact } })
        return { version, definition: data.definition, preset: prepared.configuration.preset, canPublish: true }
      })
    },
  }
}
