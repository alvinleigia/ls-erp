import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordLimits, scopeAllowsOthers } from "@/platform/access/rules"

export async function requireSalesTeamFilter(tx: Prisma.TransactionClient, actor: BusinessActor, id?: string) {
  if (!id) return
  const all = recordLimits(actor, "activities", "read").length === 0
  if (!scopeAllowsOthers(actor, "reports")) throw new BusinessError(403, "Your record limits do not include team reporting.")
  if (!all && !actor.managedTeamIds?.includes(id)) throw new BusinessError(403, "Choose a team you manage.")
  if (!await tx.businessTeam.findFirst({ where: { tenantId: actor.tenantId, id } })) throw new BusinessError(404, "Team not found.")
}
export function activityTeamFilter(id: string): Prisma.CrmTaskWhereInput {
  // Attribute work to its record's team, rather than every team the owner joins.
  return { OR: [{ enquiry: { salesTeamId: id } }, { opportunity: { salesTeamId: id } }] }
}
