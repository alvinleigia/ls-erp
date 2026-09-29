"use client"
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { CrmCheckbox, CrmSelect } from "@/modules/crm/components/crm-controls"
import { CrmPageHeader, CrmFormActions, crmPageClass } from "@/modules/crm/components/crm-page"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { choiceTitles, type ChoiceKind, type PropertyChoice } from "../choices"

export function PropertyChoiceEditor({ kind, id }: { kind: ChoiceKind; id?: string }) {
  const router = useRouter(), backHref = `/crm/configuration/real-estate/${kind}`
  const [value, setValue] = React.useState<PropertyChoice>({ id: "", name: "", position: 0, isDefault: false, archived: false, version: 1 })
  const [canManage, setCanManage] = React.useState(false), [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(""), [revision, setRevision] = React.useState(0), [originalArchived, setOriginalArchived] = React.useState(false), [confirm, setConfirm] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError("")
    fetch(`/api/real-estate/choices/${kind}${id ? `/${encodeURIComponent(id)}` : "?pageSize=1"}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load choice.")
      setCanManage(data.canManage)
      if (id) { setValue(data); setOriginalArchived(data.archived) }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [kind, id, revision])
  async function save() {
    setSaving(true); setError("")
    try {
      const { name, position, isDefault, archived, version } = value
      const response = await fetch(`/api/real-estate/choices/${kind}${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, position, isDefault, archived, ...(id ? { version } : {}) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to save choice. Check the name, order and default selection.")
      toast.success("Choice saved."); router.push(backHref)
    } catch (error) { setError((error as Error).message); setConfirm(false) } finally { setSaving(false) }
  }
  return <div className={crmPageClass}><CrmPageHeader title={id ? "Edit choice" : "New choice"} description={choiceTitles[kind]} backHref={backHref} actions={<CrmFormActions form="choice-form" cancelHref={backHref} canSave={canManage && !loading} saving={saving} saveLabel="Save choice"><Button variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Refresh</Button></CrmFormActions>} />
    {error && <p role="alert" className="text-destructive">{error}</p>}{loading ? <p>Loading choice…</p> : <form id="choice-form" onSubmit={event => { event.preventDefault(); if (id && value.archived !== originalArchived) setConfirm(true); else void save() }}>
      <CrmSection title="Choice details" description="Defaults apply to new records. Renaming a choice preserves labels already saved on records."><fieldset disabled={!canManage || saving} className="grid gap-4 sm:grid-cols-2">
        <FormField id="choice-name" label="Name"><Input id="choice-name" required maxLength={100} value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} /></FormField>
        <FormField id="choice-order" label="Display order"><Input id="choice-order" type="number" required min={0} max={1000000} value={value.position} onChange={event => setValue({ ...value, position: Number(event.target.value) })} /><p className="text-xs text-muted-foreground">Lower numbers appear first.</p></FormField>
        <FormField id="choice-status" label="Status"><CrmSelect id="choice-status" className="w-full" value={value.archived ? "archived" : "active"} onValueChange={status => setValue({ ...value, archived: status === "archived", ...(status === "archived" ? { isDefault: false } : {}) })}><option value="active">Active</option><option value="archived">Archived</option></CrmSelect></FormField>
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><CrmCheckbox checked={value.isDefault} disabled={value.archived} onChange={event => setValue({ ...value, isDefault: event.target.checked })} />Use as default</label><p className="text-xs text-muted-foreground">Replaces the current default for this list. Existing records stay unchanged.</p></div>
      </fieldset></CrmSection></form>}
    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>{value.archived ? "Archive choice?" : "Restore choice?"}</DialogTitle><DialogDescription>{value.archived ? "Existing records keep this choice. It will no longer be available for new selections or as a default." : "This choice will be available for new selections again."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void save()}>Confirm and save</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
