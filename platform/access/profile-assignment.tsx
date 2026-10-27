"use client"
import { defaultRecordRules } from "./rules"

import * as React from "react"
import { toast } from "sonner"
import { DraftPanel } from "@/components/erp/record-detail"
import { RecordSelect } from "@/components/erp/record-select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProfilePicker, RecordPolicyFields, type UserRecordPolicy } from "./profile-picker"

type Assignment = { id: string; role: string; collaboratorId?: string | null; accessAssignments: { roleId: string; role: { name: string; archived: boolean } }[]; accessPolicy: UserRecordPolicy & { version: number } }
export function ProfileAssignmentEditor({ onClose, onSaved, user }: { onClose: () => void; onSaved: () => void; user?: { id: string; name: string | null; email: string } }) {
  const [userId, setUserId] = React.useState(user?.id || "")
  const [roleIds, setRoleIds] = React.useState<string[]>([])
  const [scopes, setScopes] = React.useState<UserRecordPolicy>({ rules: defaultRecordRules() })
  const [current, setCurrent] = React.useState<Assignment | null>(null)
  const [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  const [revision, reload] = React.useReducer(value => value + 1, 0)
  const [conflict, setConflict] = React.useState(false), [denied, setDenied] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController(); setCurrent(null); setRoleIds([]); setError(""); setConflict(false); setDenied(false)
    if (userId) fetch(`/api/access/users/${userId}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (controller.signal.aborted) return; if (!response.ok) throw new Error(data.error || "Unable to load access settings.")
      if (!controller.signal.aborted) { setCurrent(data); setRoleIds(data.accessAssignments.map((item: Assignment["accessAssignments"][number]) => item.roleId)); setScopes({ rules: data.accessPolicy.rules }) }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [userId, revision])
  const eligible = current?.id === userId && ["STAFF", "MANAGER"].includes(current.role)
  return <DraftPanel key={`${current?.id || "loading"}:${current?.accessPolicy.version ?? revision}`} title="Assign access profiles" description="Combine module profiles, then set the user's record visibility. Profiles grant actions; record limits apply separately to each action." fingerprint={{ userId, roleIds, scopes }} saving={saving} disabled={!eligible || conflict || denied} error={error} footerActions={userId && <button type="button" disabled={saving} className="text-sm underline" onClick={reload}>Reload saved access</button>} onClose={onClose} onSubmit={async () => {
    if (!current || current.id !== userId) return
    setSaving(true); setError("")
    try {
      const response = await fetch(`/api/access/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleIds, ...scopes, version: current.accessPolicy.version }) })
      const data = await response.json(); if (response.status === 409) setConflict(true); if ([401, 403].includes(response.status)) setDenied(true); if (!response.ok) throw new Error(data.error || "Unable to save access settings.")
      toast.success("Access profiles saved."); window.dispatchEvent(new Event("business-modules-changed")); onSaved()
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }}>
    <div className="space-y-2"><Label htmlFor="access-user">User</Label>{user ? <Input id="access-user" readOnly value={`${user.name || user.email} (${user.email})`} /> : <RecordSelect id="access-user" endpoint="/api/users" value={userId} onChange={setUserId} disabled={saving} />}</div>
    {current && !eligible && <p role="alert">Choose a Staff or Manager account. Tenant administrators retain full access.</p>}
    {eligible && <><ProfilePicker id="assigned-profiles" value={roleIds} onChange={setRoleIds} selected={current.accessAssignments.map(item => ({ id: item.roleId, name: `${item.role.name}${item.role.archived ? " (archived)" : ""}` }))} disabled={saving || denied} external={Boolean(current.collaboratorId)} />{current.collaboratorId && <p className="text-sm text-muted-foreground">Only business actions apply. Employee permissions and internal team management remain unavailable.</p>}<RecordPolicyFields value={scopes} onChange={patch => setScopes(previous => ({ ...previous, ...patch }))} disabled={saving || denied} external={Boolean(current.collaboratorId)} /></>}
  </DraftPanel>
}
