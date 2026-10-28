import { informationPartyKey } from "./information"
import { participantInformationSchema, participantSnapshotSchema, type ParticipantInformation, type ParticipantSnapshot } from "./validation"

export function withParticipantInformation(snapshot: ParticipantSnapshot, input: unknown): ParticipantSnapshot {
  if (input === null || input === undefined) return snapshot
  const information = participantInformationSchema.parse(input)
  const records = new Map(information.records.map(row => [informationPartyKey(row.party), row.values]))
  return participantSnapshotSchema.parse({ ...snapshot, participants: snapshot.participants.map(row => {
    const values = records.get(informationPartyKey(row.party))
    return values ? { ...row, information: values } : row
  }) })
}
export function pruneParticipantInformation(input: unknown, snapshot: ParticipantSnapshot): ParticipantInformation | undefined {
  if (input === null || input === undefined) return undefined
  const information = participantInformationSchema.parse(input)
  const active = new Set(snapshot.participants.map(row => informationPartyKey(row.party)))
  return { format: 1, records: information.records.filter(row => active.has(informationPartyKey(row.party))) }
}
