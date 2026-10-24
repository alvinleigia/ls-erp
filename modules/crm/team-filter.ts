import type { Prisma } from "@prisma/client"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { salesRecordAccess } from "@/platform/access/record-scope"

export async function requireSalesTeamFilter(tx: Prisma.TransactionClient, actor: BusinessActor, id?: string) {
  if (!id) return
  const scope = salesRecordAccess(actor)
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") throw new BusinessError(403, "Team reporting is available to managers only.")
  if (scope !== "ALL" && !actor.managedTeamIds?.includes(id)) throw new BusinessError(403, "Choose a team you manage.")
  if (!await tx.businessTeam.findFirst({ where: { tenantId: actor.tenantId, id } })) throw new BusinessError(404, "Team not found.")
}
export function activityTeamFilter(id: string): Prisma.CrmTaskWhereInput {
  // Attribute work to its record's team, rather than every team the owner joins.
  return { OR: [{ enquiry: { salesTeamId: id } }, { opportunity: { salesTeamId: id } }] }
}
