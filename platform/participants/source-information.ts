import { informationPartyKey } from "./information"
import { participantInformationSchema, participantSnapshotSchema, type ParticipantInformation, type ParticipantSnapshot } from "./validation"

// A saved row is authoritative, including deliberately empty fields. Defaults
// seed missing identities once; they are never merged over transaction edits.
export function initializeParticipantInformation(input: unknown, defaults: ParticipantInformation): ParticipantInformation {
  const saved = input === null || input === undefined ? { format: 1 as const, records: [] } : participantInformationSchema.parse(input)
  const existing = new Set(saved.records.map(row => informationPartyKey(row.party)))
  return participantInformationSchema.parse({ ...saved, records: [...saved.records, ...participantInformationSchema.parse(defaults).records.filter(row => !existing.has(informationPartyKey(row.party)))] })
}

export function withParticipantInformation(snapshot: ParticipantSnapshot, input: unknown): ParticipantSnapshot {
  if (input === null || input === undefined) return snapshot
  const information = participantInformationSchema.parse(input)
  const records = new Map(information.records.map(row => [informationPartyKey(row.party), row]))
  return participantSnapshotSchema.parse({ ...snapshot, participants: snapshot.participants.map(row => {
    const saved = records.get(informationPartyKey(row.party))
    return saved ? { role: row.role, party: row.party, information: saved.values, ...(saved.addresses ? { addresses: saved.addresses } : {}), ...(saved.addressReferences ? { addressReferences: saved.addressReferences } : {}) } : row
  }) })
}
export function pruneParticipantInformation(input: unknown, snapshot: ParticipantSnapshot): ParticipantInformation | undefined {
  if (input === null || input === undefined) return undefined
  const information = participantInformationSchema.parse(input)
  const active = new Set(snapshot.participants.map(row => informationPartyKey(row.party)))
  return { format: 1, records: information.records.filter(row => active.has(informationPartyKey(row.party))) }
}
