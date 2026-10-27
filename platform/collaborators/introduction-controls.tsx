"use client"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { RecordSelect } from "@/components/erp/record-select"
import { Section } from "@/components/erp/section"
import { useBusinessModules } from "@/platform/module-provider"
import type { PartnerIntroductionEvidence } from "./contracts"

export function IntroductionSelection({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const { canManage } = useBusinessModules()
  return <Section title="Introducing collaborator" description="Separate from the salesperson and contact referral. Recorded when this record is created.">
    {canManage ? <FormField id="introducing-collaborator" label="Introducing collaborator (optional)"><RecordSelect id="introducing-collaborator" endpoint="/api/collaborators?status=active" value={value} onChange={onChange} disabled={disabled} showCode placeholder="Choose a collaborator" />{value && <Button type="button" variant="link" disabled={disabled} onClick={() => onChange("")}>Clear introducing collaborator</Button>}</FormField> : <p className="text-sm text-muted-foreground">External logins automatically record their own collaborator. Only a tenant administrator can select another collaborator.{value && " Your existing selection will be rechecked when you save."}</p>}
  </Section>
}
export const introductionFields = (record: PartnerIntroductionEvidence) => [
  { label: "Introducing collaborator", value: record.partnerAttribution ? `${record.partnerAttribution.name} (${record.partnerAttribution.code})` : "No recorded introducing partner" },
]
export function IntroductionDetails({ record }: { record: PartnerIntroductionEvidence }) {
  return <Section title="Introducing collaborator" description="Saved at introduction. Reassigning work or changing the collaborator directory does not rewrite this evidence."><p className="text-sm">{introductionFields(record)[0].value}</p></Section>
}
