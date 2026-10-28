import type { Prisma, PrismaClient } from "@prisma/client"
import type { BusinessActor } from "@/platform/policy"
import { permits } from "@/platform/access/policy"
import { salesOrderRecordScope } from "@/platform/access/record-scope"
import { moduleEnabled } from "@/platform/modules"
import { createParticipantConfigurationService, type ParticipantImpact } from "@/platform/participants/configuration"
import { missingParticipantInformation, type ParticipantFormDefinition } from "@/platform/participants/requirements"
import { realEstateParticipantPreset } from "@/modules/real-estate/participant-preset"

async function impact(tx: Prisma.TransactionClient, actor: BusinessActor, definition: ParticipantFormDefinition): Promise<ParticipantImpact> {
  const flags = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId } })
  if (!moduleEnabled(flags, "salesOrders") || !permits(actor, "salesOrders.read")) return { accessibleDrafts: null, incompleteDrafts: null }
  let cursor = "", accessibleDrafts = 0, incompleteDrafts = 0
  // The settings transaction holds the tenant writer/security locks. All order
  // writers use the matching boundary. Page the identical canonical scope,
  // keeping memory bounded without a second implementation of field validation.
  for (;;) {
    const rows = await tx.salesOrder.findMany({ where: { AND: [salesOrderRecordScope(actor), { tenantId: actor.tenantId, status: "DRAFT", ...(cursor ? { id: { gt: cursor } } : {}) }] }, orderBy: { id: "asc" }, take: 100, select: { id: true, snapshot: true } })
    for (const row of rows) {
      accessibleDrafts++
      const snapshot = row.snapshot as { participants?: unknown }
      if (missingParticipantInformation(snapshot?.participants, definition).length) incompleteDrafts++
    }
    if (rows.length < 100) break
    cursor = rows.at(-1)!.id
  }
  return { accessibleDrafts, incompleteDrafts }
}
export const applicationParticipantSettings = (db: PrismaClient, actor: Pick<BusinessActor, "tenantId" | "userId" | "requestId">) => createParticipantConfigurationService(db, actor, { preset: realEstateParticipantPreset, impact })
