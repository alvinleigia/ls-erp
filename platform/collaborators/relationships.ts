import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { permits, requirePermission } from "@/platform/access/policy"
import { assertPartnerChoice } from "./attribution"

export const partnerChangeSchema = z.object({
  version: z.number().int().positive(), partnerId: z.string().trim().min(1).max(100).nullable(),
  reason: z.string().trim().min(1, "Enter a reason for this partner change.").max(1000),
}).strict()
export const partnerChoiceQuery = z.object({
  q: z.string().trim().max(160).default(""), page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict()

// Owners supply typed source persistence and their canonical Edit predicate.
// This shared layer never grants ownership, office membership or partner login.
export async function changePartner<T extends { version: number; introducedByCollaboratorId: string | null }>(
  tx: Prisma.TransactionClient, actor: BusinessActor, before: T, input: unknown,
  persist: (partnerId: string | null, version: number) => Promise<T | null>,
) {
  const data = partnerChangeSchema.parse(input)
  if (actor.collaboratorId) throw new BusinessError(403, "External logins cannot correct introducing partners.")
  requirePermission(actor, before.introducedByCollaboratorId ? "partnerLinks.edit" : "partnerLinks.create")
  if (data.version !== before.version) throw new BusinessError(409, "This record changed. Reload before changing its partner.")
  if (data.partnerId === before.introducedByCollaboratorId) throw new BusinessError(400, "Choose a different partner or remove the current partner.")
  if (data.partnerId) { requirePermission(actor, "partnerChoices.read"); await assertPartnerChoice(tx, actor, data.partnerId) }
  await tx.$executeRaw`SELECT set_config('app.partner_change_reason',${data.reason},true)`
  const after = await persist(data.partnerId, data.version)
  if (!after) throw new BusinessError(409, "This record changed. Reload before changing its partner.")
  return { before, after, reason: data.reason }
}

export function partnerActions(actor: BusinessActor, hasPartner: boolean, editable: boolean) {
  const canChoose = !actor.collaboratorId && permits(actor, "partnerChoices.read")
  return { canChange: !actor.collaboratorId && editable && (hasPartner || canChoose) && permits(actor, hasPartner ? "partnerLinks.edit" : "partnerLinks.create"), canChoose }
}
