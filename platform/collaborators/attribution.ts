import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"

export const introducingCollaboratorId = z.string().trim().min(1).max(100).optional()
// Source evidence only. This never supplies permissions, ownership or office grants.
export async function introductionForCreate(tx: Prisma.TransactionClient, actor: BusinessActor, requested?: string) {
  if (requested && ((actor.collaboratorId && requested !== actor.collaboratorId) || (!actor.collaboratorId && actor.role !== "ADMIN"))) throw new BusinessError(403, "Only a tenant administrator can select another introducing collaborator.")
  const introducedByCollaboratorId = actor.collaboratorId || requested || null
  if (introducedByCollaboratorId && actor.role === "ADMIN" && !await tx.externalCollaborator.findFirst({ where: { tenantId: actor.tenantId, id: introducedByCollaboratorId, archived: false }, select: { id: true } })) throw new BusinessError(400, "Choose an active introducing collaborator in this workspace.")
  return { introducedByCollaboratorId }
}

export function introductionBoundaryError(error: unknown) {
  const value = error as { message?: string; meta?: { database_error?: string; driverAdapterError?: { cause?: { originalMessage?: string } } } }
  const message = [value?.message, value?.meta?.database_error, value?.meta?.driverAdapterError?.cause?.originalMessage].filter(Boolean).join(" ")
  const errors: readonly [string, number][] = [["Introduction identity and evidence are immutable", 400], ["Introduction evidence must come from its source", 400], ["Introduction source is not permitted", 404], ["Introducing collaborator selection is not permitted", 403], ["Choose an active introducing collaborator in this workspace", 400]]
  const match = errors.find(([text]) => message.includes(text))
  return match ? new BusinessError(match[1], match[0] + ".") : null
}
