import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { requirePermission } from "@/platform/access/policy"

export const introducingCollaboratorId = z.string().trim().min(1).max(100).optional()
// Source evidence only. This never supplies permissions, ownership or office grants.
export async function introductionForCreate(tx: Prisma.TransactionClient, actor: BusinessActor, requested?: string) {
  if (requested && actor.collaboratorId && requested !== actor.collaboratorId) throw new BusinessError(403, "Introducing collaborator selection is not permitted.")
  const introducedByCollaboratorId = actor.collaboratorId || requested || null
  if (requested && !actor.collaboratorId) {
    requirePermission(actor, ["partnerChoices.read", "partnerLinks.create"])
    await assertPartnerChoice(tx, actor, requested)
  }
  return { introducedByCollaboratorId }
}

export async function assertPartnerChoice(tx: Prisma.TransactionClient, actor: BusinessActor, id: string) {
  const [choice] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.partner_choice_allowed(${actor.tenantId},${id}) AS allowed`
  if (!choice?.allowed) throw new BusinessError(400, "Choose an active introducing collaborator within your partner access.")
}

export function introductionBoundaryError(error: unknown) {
  const value = error as { message?: string; meta?: { database_error?: string; driverAdapterError?: { cause?: { originalMessage?: string } } } }
  const message = [value?.message, value?.meta?.database_error, value?.meta?.driverAdapterError?.cause?.originalMessage].filter(Boolean).join(" ")
  const errors: readonly [string, number][] = [["Introduction identity and evidence are immutable", 400], ["Introduction evidence must come from its source", 400], ["Introduction source is not permitted", 404], ["Introducing collaborator selection is not permitted", 403], ["Choose an active introducing collaborator in this workspace", 400], ["Partner changes require a reason and current record version", 400], ["Partner correction is outside parent record access", 403]]
  const match = errors.find(([text]) => message.includes(text))
  return match ? new BusinessError(match[1], match[0] + ".") : null
}
