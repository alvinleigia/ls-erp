import { z } from "zod"

const id = z.string().trim().min(1).max(100)
export const participantRoleSchema = z.enum(["CUSTOMER", "ADDITIONAL_CUSTOMER", "REPRESENTATIVE"])
export const participantPartyReferenceSchema = z.object({ kind: z.enum(["PERSON", "BUSINESS"]), id }).strict()
export const participantSelectionSchema = z.object({ role: participantRoleSchema, party: participantPartyReferenceSchema }).strict()

// A bounded collection of rows, not numbered applicant columns. Business roles
// do not imply ownership, payment responsibility, login or authorization.
const validateSelections = (rows: { role: string; party: { kind: string; id: string } }[], ctx: z.RefinementCtx) => {
  if (rows.filter(row => row.role === "CUSTOMER").length !== 1) {
    ctx.addIssue({ code: "custom", message: "Choose exactly one main customer." })
  }
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const key = JSON.stringify([row.role, row.party.kind, row.party.id])
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index], message: "This participant already has that role." })
    seen.add(key)
  })
}
export const participantSelectionsSchema = z.array(participantSelectionSchema).min(1).max(100).superRefine(validateSelections)

const partyDetails = {
  name: z.string().min(1).max(200).refine(value => !!value.trim(), "Enter the participant name."),
  // These preserve existing source values; identity matching and address/phone
  // normalization belong to the master-data owner, not historical snapshots.
  email: z.string().max(320).nullable(),
  phone: z.string().max(100).nullable(),
  sourceVersion: z.number().int().positive(),
}
export const resolvedParticipantPartySchema = participantPartyReferenceSchema.extend({
  tenantId: id, ...partyDetails,
}).strict()
const savedParticipantSchema = z.object({
  role: participantRoleSchema,
  party: participantPartyReferenceSchema.extend(partyDetails).strict(),
}).strict()
export const participantSnapshotSchema = z.object({
  format: z.literal(1),
  participants: z.array(savedParticipantSchema).min(1).max(100).superRefine(validateSelections),
}).strict()

export type ParticipantRole = z.infer<typeof participantRoleSchema>
export type ParticipantPartyReference = z.infer<typeof participantPartyReferenceSchema>
export type ParticipantSelection = z.infer<typeof participantSelectionSchema>
export type ResolvedParticipantParty = z.infer<typeof resolvedParticipantPartySchema>
export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>

// Minimal, already authorized customer context. Business is the buying account,
// not the issuing operating company. It intentionally omits business
// directory communication details and any identity documents or private fields.
export type CustomerParticipantSource = {
  tenantId: string
  person: { tenantId: string; id: string; name: string; email: string | null; phone: string | null; version: number }
  business: { tenantId: string; id: string; name: string; version: number } | null
}
