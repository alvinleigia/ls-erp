"use client"
import * as React from "react"
import { Section } from "@/components/erp/section"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/erp/controls"
import { MembershipChoice, officeLabel, type MembershipValidation } from "./membership-choice"
import { membershipPreviewKey, type MembershipSubject, type MembershipCompany, type MembershipOffice, type OfficeMembershipDraft, type OfficeMemberships } from "@/types/companies"

export function OfficeMembershipFields({ subject, draft, onChange, record, editable = true, saving = false, refresh = 0, validation, onValidation, onDenied }: {
  subject: MembershipSubject; draft: OfficeMembershipDraft; onChange: (value: OfficeMembershipDraft) => void; record?: OfficeMemberships
  editable?: boolean; saving?: boolean; refresh?: number; validation: MembershipValidation | null
  onValidation: (value: MembershipValidation) => void; onDenied: () => void
}) {
  const [offices, setOffices] = React.useState<Map<string, MembershipOffice>>(() => new Map((record?.offices ?? []).map(row => [row.officeId,row.office])))
  const [companies, setCompanies] = React.useState<Map<string, MembershipCompany>>(() => new Map((record?.companies ?? []).map(row => [row.companyId,row.company])))
  return <>
    <p className="text-sm text-muted-foreground">Membership defines eligible offices. Permission profiles and record rules still control business actions. Employee workplaces, teams and leave approvals are managed separately. Tenant administrators retain oversight of every office.</p>
    {!editable && <p role="status" className="text-sm text-muted-foreground">Activate a business user before changing office memberships. Existing grants are shown below.</p>}
    <Section title="Specific offices"><p className="text-sm text-muted-foreground">Each grant includes only that office. Closed offices retain permitted history.</p>
      {editable && <FormField id="membership-office" label="Add specific office"><MembershipChoice kind="office" id="membership-office" subject={subject} draft={draft} disabled={saving} onDenied={onDenied} onPick={choice => { if (!choice?.office || draft.officeIds.includes(choice.id) || draft.officeIds.length >= 200) return; setOffices(previous => new Map(previous).set(choice.id,choice.office!)); onChange({ ...draft, officeIds: [...draft.officeIds,choice.id] }) }} /></FormField>}
      <ul aria-label="Specific office grants" className="space-y-2">{draft.officeIds.map(id => <li key={id} className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-3"><span className="min-w-0 break-words text-sm">{offices.has(id) ? officeLabel(offices.get(id)!) : "Saved office"}</span>{editable && <Button type="button" size="sm" variant="ghost" disabled={saving} aria-label={`Remove office ${offices.get(id)?.name || id}`} onClick={() => onChange({ ...draft, officeIds: draft.officeIds.filter(value => value !== id) })}>Remove</Button>}</li>)}</ul>
      {!draft.officeIds.length && <p className="text-sm text-muted-foreground">No specific office grants.</p>}
    </Section>
    <Section title="Company grants"><p className="text-sm text-muted-foreground">A company grant includes its current and future offices. Include subsidiary companies only when intended.</p>
      {editable && <FormField id="membership-company" label="Add company"><MembershipChoice kind="company" id="membership-company" subject={subject} draft={draft} disabled={saving} onDenied={onDenied} onPick={choice => { if (!choice?.company || draft.companies.some(row => row.companyId === choice.id) || draft.companies.length >= 100) return; setCompanies(previous => new Map(previous).set(choice.id,choice.company!)); onChange({ ...draft, companies: [...draft.companies,{companyId:choice.id,includeSubsidiaries:false}] }) }} /></FormField>}
      <ul aria-label="Company office grants" className="space-y-2">{draft.companies.map(grant => { const company = companies.get(grant.companyId); return <li key={grant.companyId} className="min-w-0 space-y-3 rounded-md border p-3"><div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{company?.name || "Saved company"}{company?.archived ? " (closed)" : ""}</span>{editable && <Button type="button" size="sm" variant="ghost" disabled={saving} aria-label={`Remove company ${company?.name || grant.companyId}`} onClick={() => onChange({ ...draft, companies: draft.companies.filter(row => row.companyId !== grant.companyId) })}>Remove</Button>}</div><label className="flex items-start gap-2 text-sm"><Checkbox disabled={saving || !editable} checked={grant.includeSubsidiaries} aria-label={`Include subsidiary companies for ${company?.name || grant.companyId}`} onChange={event => onChange({ ...draft, companies: draft.companies.map(row => row.companyId === grant.companyId ? { ...row, includeSubsidiaries:event.target.checked } : row) })} />Include subsidiary companies</label></li> })}</ul>
      {!draft.companies.length && <p className="text-sm text-muted-foreground">No company grants.</p>}
    </Section>
    <Section title="Creation office"><p className="text-sm text-muted-foreground">Choose the initial office for new independent records. Saved records keep their office. Clear this choice when no creation office should be selected.</p>
      {editable ? <><FormField id="membership-creation" label="Creation office"><MembershipChoice kind="creation" id="membership-creation" subject={subject} draft={draft} value={draft.creationOfficeId || ""} saved={record?.creationOffice} disabled={saving} refresh={refresh} onValidation={onValidation} onDenied={onDenied} onPick={choice => onChange({ ...draft, creationOfficeId: choice?.id ?? null })} /></FormField>{validation?.key === membershipPreviewKey(subject, draft) && !validation.valid && draft.creationOfficeId && <p role="alert" className="text-sm text-destructive">Choose an active office covered by these grants, or select No creation office.</p>}</> : <p>{record?.creationOffice ? officeLabel(record?.creationOffice) : "No creation office"}</p>}
    </Section>
  </>
}
