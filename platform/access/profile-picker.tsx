"use client"
import * as React from "react"
import { RecordSelect } from "@/components/erp/record-select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { scopeNames, supportedScopes, type RecordRules, type RecordScope } from "./rules"
import { accessResources, resourceKeys, type Permission } from "./catalog"

export function ProfilePicker({ id, value, onChange, selected = [], disabled = false }: { id: string; value: string[]; onChange: (ids: string[]) => void; selected?: { id: string; name: string }[]; disabled?: boolean }) {
  const [names, setNames] = React.useState<Record<string, string>>({})
  return <div className="space-y-3"><Label htmlFor={id}>Add access profile</Label><RecordSelect id={id} endpoint="/api/access/roles" value="" onChange={(roleId, option) => { if (!roleId || value.includes(roleId)) return; setNames(previous => ({ ...previous, [roleId]: option?.label ?? roleId })); onChange([...value, roleId]) }} disabled={disabled || value.length >= 50} placeholder="Search profiles..." />
    {value.length ? <ul className="space-y-2" aria-label="Selected access profiles">{value.map(roleId => { const name = names[roleId] ?? selected.find(item => item.id === roleId)?.name ?? roleId; return <li key={roleId} className="flex items-center justify-between gap-3 rounded-md border p-2"><span className="min-w-0 break-words text-sm">{name}</span><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`Remove ${name}`} onClick={() => onChange(value.filter(item => item !== roleId))}>Remove</Button></li> })}</ul> : <p className="text-sm text-muted-foreground">No profiles selected. Business access stays disabled until profiles are assigned.</p>}
  </div>
}
export type UserRecordPolicy = { rules: RecordRules }
export function RecordPolicyFields({ value, onChange, disabled = false }: { value: UserRecordPolicy; onChange: (patch: Partial<UserRecordPolicy>) => void; disabled?: boolean }) {
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">Record limits apply across profiles. Every action is also bounded by Read. Profiles must grant the action; selecting a scope alone grants nothing.</p>{resourceKeys.map(resource => <details key={resource} className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">{accessResources[resource].name}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{accessResources[resource].actions.map(action => {
    const permission = (resource + "." + action) as Permission
    const id = "scope-" + resource + "-" + action
    return <div key={permission} className="space-y-1"><Label htmlFor={id}>{action.charAt(0).toUpperCase() + action.slice(1)}</Label><DropdownSelect id={id} label={accessResources[resource].name + ": " + action} disabled={disabled} value={value.rules[permission] ?? "NONE"} options={supportedScopes(resource).map(scope => ({ value: scope, label: scopeNames[scope] }))} onValueChange={scope => onChange({ rules: { ...value.rules, [permission]: scope as RecordScope } })} /></div>
  })}</div></details>)}</div>
}
