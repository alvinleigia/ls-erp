import type { Prisma } from "@prisma/client"
import { BusinessError } from "@/platform/policy"
import { buildParticipantSnapshot } from "@/platform/participants/snapshot"
import { savedParticipantSchema, participantSnapshotSchema, type CustomerParticipantSource, type ParticipantSnapshot } from "@/platform/participants/validation"
import { crmQuotationParticipants } from "./participants"

type Tx = Prisma.TransactionClient
export const participantOrder = [{ position: "asc" }, { id: "asc" }] as const
export function savedParticipant(row: { role: string; contactId: string | null; accountId: string | null; details: Prisma.JsonValue }) {
  return savedParticipantSchema.parse({ role: row.role, party: {
    ...(row.details as object), kind: row.contactId ? "PERSON" : "BUSINESS", id: row.contactId || row.accountId,
  } })
}
export function combineParticipants(source: CustomerParticipantSource, extra: ParticipantSnapshot["participants"]) {
  const base = crmQuotationParticipants(source).participants
  const main = base.find(row => row.role === "CUSTOMER")!.party
  if (extra.some(row => row.party.kind === main.kind && row.party.id === main.id)) throw new BusinessError(409, "The main customer is already included. Remove its additional participant row before changing the customer.")
  const rows = [...base, ...extra]
  const parties = new Map(rows.map(row => [JSON.stringify([row.party.kind, row.party.id]), { ...row.party, tenantId: source.tenantId }]))
  // A person can have distinct roles. Each row retains its accepted evidence;
  // validate references together without rewriting a saved role's display facts.
  buildParticipantSnapshot(source.tenantId, rows.map(row => ({ role: row.role, party: { kind: row.party.kind, id: row.party.id } })), [...parties.values()])
  return participantSnapshotSchema.parse({ format: 1, participants: rows })
}
// The quotation service supplies its exact scoped source read and transaction.
export async function crmSourceParticipants(tx: Tx, opportunityId: string, source: CustomerParticipantSource) {
  const rows = await tx.crmOpportunityParticipant.findMany({ where: { tenantId: source.tenantId, opportunityId }, orderBy: [...participantOrder] })
  return combineParticipants(source, rows.map(savedParticipant))
}
