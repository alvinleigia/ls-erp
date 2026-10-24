"use client"
import * as React from "react"
import { RecordSelect } from "@/components/erp/record-select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { recordScopes, type RecordScope } from "./record-scope"

export function ProfilePicker({ id, value, onChange, selected = [], disabled = false }: { id: string; value: string[]; onChange: (ids: string[]) => void; selected?: { id: string; name: string }[]; disabled?: boolean }) {
  const [names, setNames] = React.useState<Record<string, string>>({})
  return <div className="space-y-3"><Label htmlFor={id}>Add access profile</Label><RecordSelect id={id} endpoint="/api/access/roles" value="" onChange={(roleId, option) => { if (!roleId || value.includes(roleId)) return; setNames(previous => ({ ...previous, [roleId]: option?.label ?? roleId })); onChange([...value, roleId]) }} disabled={disabled || value.length >= 50} placeholder="Search profiles..." />
    {value.length ? <ul className="space-y-2" aria-label="Selected access profiles">{value.map(roleId => { const name = names[roleId] ?? selected.find(item => item.id === roleId)?.name ?? roleId; return <li key={roleId} className="flex items-center justify-between gap-3 rounded-md border p-2"><span className="min-w-0 break-words text-sm">{name}</span><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`Remove ${name}`} onClick={() => onChange(value.filter(item => item !== roleId))}>Remove</Button></li> })}</ul> : <p className="text-sm text-muted-foreground">No profiles selected. Business access stays disabled until profiles are assigned.</p>}
  </div>
}
export type UserRecordScopes = { salesRecordScope: RecordScope; projectRecordScope: RecordScope }
export function RecordScopeFields({ value, onChange, disabled = false }: { value: UserRecordScopes; onChange: (patch: Partial<UserRecordScopes>) => void; disabled?: boolean }) {
  return <div className="space-y-4">{([{ field: "salesRecordScope", label: "Sales record scope" }, { field: "projectRecordScope", label: "Project record scope" }] as const).map(({ field, label }) => <div key={field} className="space-y-2"><Label htmlFor={field}>{label}</Label><DropdownSelect id={field} label={label} disabled={disabled} value={value[field]} options={recordScopes.map(scope => ({ value: scope, label: { ACCOUNT_ROLE: "Account authority", OWN: "Own / assigned records", MANAGED_TEAMS: "Own and managed teams", ALL: "All tenant records" }[scope] }))} onValueChange={scope => onChange({ [field]: scope as RecordScope })} /></div>)}<p className="text-sm text-muted-foreground">These visibility limits apply across all selected profiles. Adding a profile does not change them. Staff retain assigned sales access; project membership can grant project read access. Leave approval still follows the reporting manager.</p></div>
}
