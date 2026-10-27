"use client"
import * as React from "react"
import { toast } from "sonner"
import { DraftPanel, RecordPanel } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/erp/controls"
import { MembershipChoice, officeLabel, type MembershipValidation } from "./membership-choice"
import { membershipDraftKey, type MembershipCompany, type MembershipOffice, type OfficeMembershipDraft, type OfficeMemberships } from "@/types/companies"
import type { UserRow } from "@/types/users"

type Subject = Pick<UserRow, "id" | "name" | "email" | "role" | "status">
export function OfficeMembershipEditor({ user, onClose, onSaved }: { user: Subject; onClose: () => void; onSaved: () => void }) {
  const [record, setRecord] = React.useState<OfficeMemberships | null>(null), [error, setError] = React.useState("")
  const [revision, reload] = React.useReducer(value => value+1, 0)
  const denied = React.useCallback(() => { setRecord(null); setError("Office membership access is not permitted. Reload to check your current access.") }, [])
  React.useEffect(() => {
    const controller = new AbortController(); setRecord(null); setError("")
    fetch(`/api/access/users/${encodeURIComponent(user.id)}/offices`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (controller.signal.aborted) return
      if (!response.ok) throw new Error(data.error || "Unable to load office memberships.")
      setRecord(data)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [user.id, revision])
  if (!record) return <RecordPanel title="Office access" description={user.name || user.email} onClose={onClose} actions={<Button variant="outline" onClick={reload}>Reload</Button>}>
    {error ? <p role="alert" className="text-destructive">{error}</p> : <p>Loading office memberships...</p>}
  </RecordPanel>
  return <MembershipDraft key={revision} user={user} record={record} onClose={onClose} onSaved={onSaved} onReload={reload} onDenied={denied} />
}
function MembershipDraft({ user, record, onClose, onSaved, onReload, onDenied }: { user: Subject; record: OfficeMemberships; onClose: () => void; onSaved: () => void; onReload: () => void; onDenied: () => void }) {
  const [draft, setDraft] = React.useState<OfficeMembershipDraft>(() => ({ officeIds: record.offices.map(row => row.officeId), companies: record.companies.map(({ companyId, includeSubsidiaries }) => ({ companyId, includeSubsidiaries })), creationOfficeId: record.creationOfficeId }))
  const [offices, setOffices] = React.useState<Map<string, MembershipOffice>>(() => new Map(record.offices.map(row => [row.officeId,row.office])))
  const [companies, setCompanies] = React.useState<Map<string, MembershipCompany>>(() => new Map(record.companies.map(row => [row.companyId,row.company])))
  const [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  const [conflict, setConflict] = React.useState(false), [refresh, setRefresh] = React.useState(0)
  const [validation, setValidation] = React.useState<MembershipValidation | null>(null)
  const validate = React.useCallback((value: MembershipValidation) => setValidation(value), [])
  const editable = ["ADMIN", "MANAGER", "STAFF"].includes(user.role) && user.status === "ACTIVE"
  const valid = validation?.key === membershipDraftKey(draft) && validation.valid
  return <DraftPanel title="Office access" description={user.name ? `${user.name} / ${user.email}` : user.email} fingerprint={draft} saving={saving} disabled={!editable || !valid || conflict} error={error} onClose={onClose} saveLabel="Save office access" footerActions={error ? <Button type="button" variant="outline" disabled={saving} onClick={onReload}>Discard draft and reload</Button> : undefined} onSubmit={async () => {
    if (!editable || !valid || conflict || saving) return
    setSaving(true); setError("")
    try {
      const response = await fetch(`/api/access/users/${encodeURIComponent(user.id)}/offices`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, version: record.version }) })
      const data = await response.json()
      if (!response.ok) { if (response.status === 403) { onDenied(); return } if (response.status === 409) setConflict(true); throw new Error(data.error || "Unable to save office memberships.") }
      toast.success("Office access saved."); onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save office memberships."); setValidation(null); setRefresh(value => value+1) }
    finally { setSaving(false) }
  }}>
    <p className="text-sm text-muted-foreground">Membership defines eligible offices. Permission profiles and record rules still control business actions. Employee workplaces, teams and leave approvals are managed separately. Tenant administrators retain oversight of every office.</p>
    {!editable && <p role="status" className="text-sm text-muted-foreground">Activate a business user before changing office memberships. Existing grants are shown below.</p>}
    <Section title="Specific offices"><p className="text-sm text-muted-foreground">Each grant includes only that office. Closed offices retain permitted history.</p>
      {editable && <FormField id="membership-office" label="Add specific office"><MembershipChoice kind="office" id="membership-office" userId={user.id} draft={draft} disabled={saving} onDenied={onDenied} onPick={choice => { if (!choice?.office || draft.officeIds.includes(choice.id) || draft.officeIds.length >= 200) return; setOffices(previous => new Map(previous).set(choice.id,choice.office!)); setDraft(previous => ({ ...previous, officeIds: [...previous.officeIds,choice.id] })) }} /></FormField>}
      <ul aria-label="Specific office grants" className="space-y-2">{draft.officeIds.map(id => <li key={id} className="flex min-w-0 items-center justify-between gap-2 rounded-md border p-3"><span className="min-w-0 break-words text-sm">{offices.has(id) ? officeLabel(offices.get(id)!) : "Saved office"}</span>{editable && <Button type="button" size="sm" variant="ghost" disabled={saving} aria-label={`Remove office ${offices.get(id)?.name || id}`} onClick={() => setDraft(previous => ({ ...previous, officeIds: previous.officeIds.filter(value => value !== id) }))}>Remove</Button>}</li>)}</ul>
      {!draft.officeIds.length && <p className="text-sm text-muted-foreground">No specific office grants.</p>}
    </Section>
    <Section title="Company grants"><p className="text-sm text-muted-foreground">A company grant includes its current and future offices. Include subsidiary companies only when intended.</p>
      {editable && <FormField id="membership-company" label="Add company"><MembershipChoice kind="company" id="membership-company" userId={user.id} draft={draft} disabled={saving} onDenied={onDenied} onPick={choice => { if (!choice?.company || draft.companies.some(row => row.companyId === choice.id) || draft.companies.length >= 100) return; setCompanies(previous => new Map(previous).set(choice.id,choice.company!)); setDraft(previous => ({ ...previous, companies: [...previous.companies,{companyId:choice.id,includeSubsidiaries:false}] })) }} /></FormField>}
      <ul aria-label="Company office grants" className="space-y-2">{draft.companies.map(grant => { const company = companies.get(grant.companyId); return <li key={grant.companyId} className="min-w-0 space-y-3 rounded-md border p-3"><div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{company?.name || "Saved company"}{company?.archived ? " (closed)" : ""}</span>{editable && <Button type="button" size="sm" variant="ghost" disabled={saving} aria-label={`Remove company ${company?.name || grant.companyId}`} onClick={() => setDraft(previous => ({ ...previous, companies: previous.companies.filter(row => row.companyId !== grant.companyId) }))}>Remove</Button>}</div><label className="flex items-start gap-2 text-sm"><Checkbox disabled={saving || !editable} checked={grant.includeSubsidiaries} aria-label={`Include subsidiary companies for ${company?.name || grant.companyId}`} onChange={event => setDraft(previous => ({ ...previous, companies: previous.companies.map(row => row.companyId === grant.companyId ? { ...row, includeSubsidiaries:event.target.checked } : row) }))} />Include subsidiary companies</label></li> })}</ul>
      {!draft.companies.length && <p className="text-sm text-muted-foreground">No company grants.</p>}
    </Section>
    <Section title="Creation office"><p className="text-sm text-muted-foreground">Choose the initial office for new independent records. Saved records keep their office. Clear this choice when no creation office should be selected.</p>
      {editable ? <><FormField id="membership-creation" label="Creation office"><MembershipChoice kind="creation" id="membership-creation" userId={user.id} draft={draft} value={draft.creationOfficeId || ""} saved={record.creationOffice} disabled={saving} refresh={refresh} onValidation={validate} onDenied={onDenied} onPick={choice => setDraft(previous => ({ ...previous, creationOfficeId: choice?.id ?? null }))} /></FormField>{validation?.key === membershipDraftKey(draft) && !validation.valid && draft.creationOfficeId && <p role="alert" className="text-sm text-destructive">Choose an active office covered by these grants, or select No creation office.</p>}</> : <p>{record.creationOffice ? officeLabel(record.creationOffice) : "No creation office"}</p>}
    </Section>
  </DraftPanel>
}
