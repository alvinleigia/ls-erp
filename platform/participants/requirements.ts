import { z } from "zod"
import { correspondenceSchema, informationFields, informationLabels, type InformationField } from "./information"
import { participantRoleSchema, participantRoleLabels, participantSnapshotSchema, type ParticipantRole, type ParticipantSnapshot } from "./validation"

const field = z.enum(informationFields)
const fields = z.array(field).max(informationFields.length).refine(value => new Set(value).size === value.length, "Choose each field once.")
const caption = z.string().trim().min(1).max(60)
export const participantFormDefinitionSchema = z.object({
  format: z.literal(1),
  title: caption,
  labels: z.object(Object.fromEntries(informationFields.map(key => [key, caption])) as Record<InformationField, typeof caption>).strict(),
  required: z.object({ CUSTOMER: fields, ADDITIONAL_CUSTOMER: fields, REPRESENTATIVE: fields }).strict(),
}).strict()
export type ParticipantFormDefinition = z.infer<typeof participantFormDefinitionSchema>
export type ParticipantFormPreset = { id: string; version: number; title: string; roleLabels: Record<ParticipantRole, string> }
export const genericParticipantPreset: ParticipantFormPreset = { id: "customer-details", version: 1, title: "Customer details", roleLabels: participantRoleLabels }
export const defaultParticipantDefinition = (preset = genericParticipantPreset): ParticipantFormDefinition => ({ format: 1, title: preset.title, labels: { ...informationLabels }, required: { CUSTOMER: [], ADDITIONAL_CUSTOMER: [], REPRESENTATIVE: [] } })
export type ParticipantFormConfiguration = { version: number; definition: ParticipantFormDefinition; preset: ParticipantFormPreset }
export const participantSettingsInputSchema = z.object({ version: z.number().int().min(0), definition: participantFormDefinitionSchema }).strict()
export const participantSettingsPublishSchema = participantSettingsInputSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()

export type MissingParticipantInformation = { participant: string; role: ParticipantRole; field: InformationField | "participants"; label: string }
export function missingParticipantInformation(snapshot: unknown, definition: ParticipantFormDefinition): MissingParticipantInformation[] {
  if (!Object.values(definition.required).some(values => values.length)) return []
  const parsed = participantSnapshotSchema.safeParse(snapshot)
  if (!parsed.success) return [{ participant: "Customer", role: "CUSTOMER", field: "participants", label: "Saved participants" }]
  return parsed.data.participants.flatMap(row => definition.required[row.role].flatMap(key => {
    const value = row.information ? row.information[key] : key === "email" || key === "phone" ? row.party[key] ?? "" : ""
    const valid = correspondenceSchema.shape[key].safeParse(value)
    return valid.success && !!valid.data.trim() ? [] : [{ participant: row.party.name, role: row.role, field: key, label: definition.labels[key] }]
  }))
}
export function participantConfirmationProof(snapshot: unknown, configuration: ParticipantFormConfiguration) {
  const missing = missingParticipantInformation(snapshot, configuration.definition)
  return { missing, proof: { format: 1 as const, configurationVersion: configuration.version, preset: configuration.preset, definition: configuration.definition } }
}
export type ParticipantConfirmationProof = ReturnType<typeof participantConfirmationProof>["proof"]
export const participantRoles = participantRoleSchema.options
export type ParticipantInformationView = { version: number; configuration: ParticipantFormConfiguration; participants: ParticipantSnapshot["participants"]; canEdit: boolean; missing: MissingParticipantInformation[] }
export function defaultInformation(row: ParticipantSnapshot["participants"][number]) {
  return row.information ?? { email: row.party.email ?? "", phone: row.party.phone ?? "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", country: "" }
}
