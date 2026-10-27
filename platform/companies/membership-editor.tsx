"use client"
import * as React from "react"
import { toast } from "sonner"
import { DraftPanel, RecordPanel } from "@/components/erp/record-detail"
import { Button } from "@/components/ui/button"
import type { MembershipValidation } from "./membership-choice"
import { OfficeMembershipFields } from "./membership-fields"
import { membershipPreviewKey, type OfficeMembershipDraft, type OfficeMemberships } from "@/types/companies"
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
  const [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  const [conflict, setConflict] = React.useState(false), [refresh, setRefresh] = React.useState(0)
  const [validation, setValidation] = React.useState<MembershipValidation | null>(null)
  const validate = React.useCallback((value: MembershipValidation) => setValidation(value), [])
  const editable = ["ADMIN", "MANAGER", "STAFF"].includes(user.role) && user.status === "ACTIVE"
  const subject = { kind: "user" as const, userId: user.id }
  const valid = validation?.key === membershipPreviewKey(subject, draft) && validation.valid
  return <DraftPanel title="Office access" description={user.name ? `${user.name} / ${user.email}` : user.email} fingerprint={draft} saving={saving} disabled={!editable || !valid || conflict} error={error} onClose={onClose} saveLabel="Save office access" footerActions={error ? <Button type="button" variant="outline" disabled={saving} onClick={onReload}>Discard draft and reload</Button> : undefined} onSubmit={async () => {
    if (!editable || !valid || conflict || saving) return
    setSaving(true); setError("")
    try {
      const response = await fetch(`/api/access/users/${encodeURIComponent(user.id)}/offices`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, version: record.version }) })
      const data = await response.json()
      if (!response.ok) { if ([401, 403].includes(response.status)) { onDenied(); return } if (response.status === 409) setConflict(true); throw new Error(data.error || "Unable to save office memberships.") }
      toast.success("Office access saved."); onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save office memberships."); setValidation(null); setRefresh(value => value+1) }
    finally { setSaving(false) }
  }}>
    <OfficeMembershipFields subject={subject} draft={draft} onChange={setDraft} record={record} editable={editable} saving={saving} refresh={refresh} validation={validation} onValidation={validate} onDenied={onDenied} />
  </DraftPanel>
}
