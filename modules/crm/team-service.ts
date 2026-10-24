import type { Prisma } from "@prisma/client"
import { recordLimits } from "@/platform/access/rules"
import { requirePermission } from "@/platform/access/policy"
import { CrmError, type CrmActor } from "./policy"
type Tx = Prisma.TransactionClient

// Team membership restricts new assignment; it never grants access to another
// salesperson's records. Explicit manager designation and role scopes control access.
export async function resolveSalesTeam(tx: Tx, actor: CrmActor, requested: string | null | undefined, owner: string, before?: { salesTeamId: string | null; assignedUserId: string }) {
  const id = requested === undefined ? before?.salesTeamId ?? null : requested || null
  const unchanged = !!before && before.salesTeamId === id && before.assignedUserId === owner
  if (before && before.salesTeamId !== id) requirePermission(actor, `${actor.operation?.resource ?? "enquiries"}.assign`)
  if (!id) return null
  if (!unchanged && recordLimits(actor, actor.operation?.resource ?? "enquiries").includes("MANAGED_TEAMS") && !actor.managedTeamIds?.includes(id)) throw new CrmError(403, "Choose a sales team you manage.")
  const team = await tx.businessTeam.findFirst({ where: { tenantId: actor.tenantId, id } })
  if (!team) throw new CrmError(404, "Sales team not found.")
  if (!unchanged) {
    if (team.archived) throw new CrmError(409, "Choose an active sales team.")
    const member = await tx.businessTeamMember.findUnique({ where: { tenantId_teamId_userId: { tenantId: actor.tenantId, teamId: id, userId: owner } } })
    if (!member) throw new CrmError(400, "Choose a salesperson who belongs to this sales team.")
  }
  return team
}
