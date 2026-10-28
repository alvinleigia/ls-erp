import { BusinessError } from "@/platform/policy"
import { participantSelectionsSchema, participantSnapshotSchema, resolvedParticipantPartySchema } from "./validation"
import type { ParticipantPartyReference, ParticipantSelection, ParticipantSnapshot, ResolvedParticipantParty } from "./validation"

const key = (party: ParticipantPartyReference) => JSON.stringify([party.kind, party.id])

// The caller must first authorize the operation and resolve these exact parties
// through its own scoped source adapter inside the same transaction. This pure
// builder is not a directory lookup or a permission grant. Resolved names and
// communication details must never come from the caller's request body.
export function buildParticipantSnapshot(tenantId: string, selections: readonly ParticipantSelection[], resolved: readonly ResolvedParticipantParty[]): ParticipantSnapshot {
  const rows = participantSelectionsSchema.parse(selections)
  const wanted = new Set(rows.map(row => key(row.party)))
  const parties = new Map<string, ResolvedParticipantParty>()
  for (const candidate of resolved) {
    const party = resolvedParticipantPartySchema.parse(candidate)
    if (party.tenantId !== tenantId || !wanted.has(key(party)) || parties.has(key(party))) {
      throw new BusinessError(409, "Participant source does not match this transaction.")
    }
    parties.set(key(party), party)
  }
  if (parties.size !== wanted.size) throw new BusinessError(409, "A participant is no longer available. Refresh before continuing.")
  return participantSnapshotSchema.parse({ format: 1, participants: rows.map(row => {
    const party = parties.get(key(row.party))!
    return { role: row.role, party: {
      kind: party.kind, id: party.id, name: party.name,
      email: party.email, phone: party.phone, sourceVersion: party.sourceVersion,
    } }
  }) })
}
