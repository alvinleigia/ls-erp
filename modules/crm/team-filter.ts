import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordLimits, scopeAllowsOthers } from "@/platform/access/rules"

export async function requireSalesTeamFilter(tx: Prisma.TransactionClient, actor: BusinessActor, id?: string) {
  if (!id) return null
  const all = recordLimits(actor, "activities", "read").length === 0
  if (!scopeAllowsOthers(actor, "reports")) throw new BusinessError(403, "Your record limits do not include team reporting.")
  if (!all && !actor.managedTeamIds?.includes(id)) throw new BusinessError(403, "Choose a team you manage.")
  const team = await tx.businessTeam.findFirst({ where: { tenantId: actor.tenantId, id }, select: { id: true, name: true, archived: true } })
  if (!team) throw new BusinessError(404, "Team not found.")
  return team
}
export function activityTeamFilter(id: string): Prisma.CrmTaskWhereInput {
  // Attribute work to its record's team, rather than every team the owner joins.
  return { OR: [{ enquiry: { salesTeamId: id } }, { opportunity: { salesTeamId: id } }] }
}
