"use client"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { RecordSelect } from "@/components/erp/record-select"
import { Section } from "@/components/erp/section"
import { useBusinessModules } from "@/platform/module-provider"
import type { PartnerIntroductionEvidence } from "./contracts"

export function IntroductionSelection({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const { can } = useBusinessModules()
  const selectable = can(["partnerChoices.read", "partnerLinks.create"])
  return <Section title="Introducing collaborator" description="The external partner who introduced this sale, separate from its internal salesperson. External logins record their own partner automatically.">
    {selectable ? <FormField id="introducing-collaborator" label="Introducing collaborator (optional)"><RecordSelect id="introducing-collaborator" endpoint="/api/crm/partner-choices" value={value} onChange={onChange} disabled={disabled} showCode placeholder="Choose a collaborator" />{value && <Button type="button" variant="link" disabled={disabled} onClick={() => onChange("")}>Clear introducing collaborator</Button>}</FormField> : null}
  </Section>
}
export const introductionFields = (record: PartnerIntroductionEvidence) => [
  { label: "Introducing collaborator", value: record.partnerAttribution ? `${record.partnerAttribution.name} (${record.partnerAttribution.code})` : "No recorded introducing partner" },
]
export function IntroductionDetails({ record }: { record: PartnerIntroductionEvidence }) {
  return <Section title="Introducing collaborator" description="Use the Partner / CP tab for authorised additions or corrections and their history. Reassigning work or changing the collaborator directory does not change this attribution."><p className="break-words text-sm">{introductionFields(record)[0].value}</p></Section>
}
