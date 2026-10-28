"use client"
import { Section } from "@/components/erp/section"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import { informationFields, informationLabels } from "./information"
import { participantSnapshotSchema, participantKey, participantRoleLabels } from "./validation"

export function ParticipantInformationSummary({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null
  const parsed = participantSnapshotSchema.safeParse(value)
  if (!parsed.success) return <p role="alert">Saved participant details could not be read.</p>
  const snapshot = parsed.data, labels = snapshot.presentation?.labels ?? informationLabels, roles = snapshot.presentation?.roleLabels ?? participantRoleLabels
  return <Section title={snapshot.presentation?.title ?? "Saved customer details"} description="These participant identities and correspondence details belong to this saved quotation revision.">
    {snapshot.participants.map(row => <div key={participantKey(row)} className="space-y-3 rounded-md border p-4"><p className="break-words font-medium">{row.party.name}</p><p className="text-sm text-muted-foreground">{roles[row.role]}</p>
      <ReadOnlyFields fields={(row.information ? informationFields : ["email", "phone"] as const).map(field => ({ label: labels[field], value: row.information ? row.information[field] : row.party[field as "email" | "phone"] }))} />
    </div>)}
  </Section>
}
