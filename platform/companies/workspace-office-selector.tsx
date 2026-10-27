"use client"
import * as React from "react"
import { Building2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SearchableSelect } from "@/components/searchable-select"
import { FormField } from "@/components/form-field"
import { DraftPanel, RecordPanel } from "@/components/erp/record-detail"
import type { OfficeChoice, WorkspaceOfficeContext } from "@/types/companies"

const label = (office: OfficeChoice) => `${office.companyName} / ${office.name} (${office.code})`
const changedEvent = "workspace-office-changed"
export function WorkspaceOfficeSelector({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [summary, setSummary] = React.useState<WorkspaceOfficeContext | null>(null), [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false), [denied, setDenied] = React.useState(false)
  const [refresh, reload] = React.useReducer(value => value+1, 0)
  const channel = React.useRef<BroadcastChannel | null>(null)
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const connection = new BroadcastChannel(`ls-erp-office:${tenantId}:${userId}`); channel.current = connection
    connection.onmessage = event => { if (event.data === "changed") reload() }
    return () => { channel.current = null; connection.close() }
  }, [tenantId, userId])
  React.useEffect(() => {
    const focus = () => reload(), visible = () => { if (document.visibilityState === "visible") reload() }
    window.addEventListener("focus", focus); window.addEventListener(changedEvent, focus); document.addEventListener("visibilitychange", visible)
    return () => { window.removeEventListener("focus", focus); window.removeEventListener(changedEvent, focus); document.removeEventListener("visibilitychange", visible) }
  }, [])
  React.useEffect(() => {
    if (denied) { setSummary(null); setFailed(true); return }
    const controller = new AbortController()
    fetch("/api/workspace/office", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (controller.signal.aborted) return
      if (!response.ok) { if ([401,403,404].includes(response.status)) setDenied(true); throw Error("Unable to load the creation office.") }
      const data = await response.json(); if (!controller.signal.aborted) { setSummary(data); setFailed(false) }
    }).catch(() => { if (!controller.signal.aborted) { setSummary(null); setFailed(true) } })
    return () => controller.abort()
  }, [refresh, denied])
  const forbidden = React.useCallback(() => { setDenied(true); setSummary(null); setFailed(true) }, [])
  return <>
    <Button type="button" variant="outline" className="min-w-0 max-w-[min(32rem,80%)]" aria-label="Change creation office" title={summary?.creationOffice ? label(summary.creationOffice) : "Choose the office for new records"} onClick={() => { setDenied(false); setOpen(true) }}><Building2 className="size-4 shrink-0" /><span className="truncate">{failed ? "Creation office unavailable" : summary ? summary.creationOffice ? `Creation: ${label(summary.creationOffice)}` : summary.creationOfficeId ? "No active creation office" : "No creation office" : "Loading creation office..."}</span></Button>
    {open && <OfficePreferenceEditor denied={denied} onForbidden={forbidden} onRetry={() => setDenied(false)} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); window.dispatchEvent(new Event(changedEvent)); channel.current?.postMessage("changed") }} />}
  </>
}
function OfficePreferenceEditor({ onClose, onSaved, onForbidden, onRetry, denied }: { onClose: () => void; onSaved: () => void; onForbidden: () => void; onRetry: () => void; denied: boolean }) {
  const [revision, reload] = React.useReducer(value => value+1, 0)
  const [loaded, setLoaded] = React.useState<{ revision: number; value: WorkspaceOfficeContext } | null>(null), [error, setError] = React.useState("")
  React.useEffect(() => {
    if (denied) return
    const controller = new AbortController(); setError("")
    fetch("/api/workspace/office", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (controller.signal.aborted) return
      if (!response.ok) { if ([401,403,404].includes(response.status)) onForbidden(); throw Error(data.error || "Unable to load the creation office.") }
      setLoaded({ revision, value: data })
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [revision, denied, onForbidden])
  const retry = () => { reload(); onRetry() }
  if (denied || loaded?.revision !== revision) return <RecordPanel title="Creation office" description="Choose the office for new independent records." onClose={onClose} actions={<Button type="button" variant="outline" onClick={retry}>Reload office choices</Button>}><p role={denied || error ? "alert" : "status"}>{denied ? "Office selection is not permitted. Reload to check current access." : error || "Loading creation office..."}</p></RecordPanel>
  return <OfficePreferenceDraft key={revision} context={loaded.value} onClose={onClose} onSaved={onSaved} onReload={retry} onForbidden={onForbidden} />
}
function OfficePreferenceDraft({ context, onClose, onSaved, onReload, onForbidden }: { context: WorkspaceOfficeContext; onClose: () => void; onSaved: () => void; onReload: () => void; onForbidden: () => void }) {
  const [officeId, setOfficeId] = React.useState<string | null>(context.creationOfficeId)
  const [q, setQ] = React.useState(""), [page, setPage] = React.useState(1), [refresh, reload] = React.useReducer(value => value+1, 0)
  const [saving, setSaving] = React.useState(false), [conflict, setConflict] = React.useState(false), [error, setError] = React.useState(""), [choiceError, setChoiceError] = React.useState("")
  const key = JSON.stringify([officeId,q,page,refresh])
  const [view, setView] = React.useState<{ key: string; items: OfficeChoice[]; selected: OfficeChoice | null; total: number; totalPages: number } | null>(null)
  React.useEffect(() => {
    const controller = new AbortController(); setChoiceError("")
    const timer = setTimeout(() => void (async () => {
      try {
        const params = new URLSearchParams({ q, page: String(page), pageSize: "20", ...(officeId ? { selected: officeId } : {}) })
        const response = await fetch(`/api/workspace/offices?${params}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json(); if (controller.signal.aborted) return
        if (!response.ok) { if ([401,403,404].includes(response.status)) onForbidden(); throw Error(data.error || "Unable to load eligible offices.") }
        if (page > data.totalPages) { setPage(1); return }
        setView({ key, ...data })
      } catch (error) { if (!controller.signal.aborted) { setView(null); setChoiceError(error instanceof Error ? error.message : "Unable to load eligible offices.") } }
    })(),200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, officeId, q, page, onForbidden])
  const ready = view?.key === key, valid = ready && (!officeId || !!view.selected)
  const selected = ready ? view.selected : context.creationOffice?.id === officeId ? context.creationOffice : null
  const changed = officeId !== (context.creationOfficeId)
  return <DraftPanel title="Creation office" description="Applies to new independent records. Linked records keep their source office." fingerprint={officeId} onClose={onClose} saving={saving} disabled={!valid || !changed || conflict} error={error} saveLabel="Apply creation office" footerActions={error || choiceError ? <Button type="button" variant="outline" disabled={saving} onClick={onReload}>Discard choice and reload</Button> : undefined} onSubmit={async () => {
    if (!valid || !changed || conflict || saving) return
    setSaving(true); setError("")
    try {
      const response = await fetch("/api/workspace/office", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeId, version: context.version }) })
      const data = await response.json()
      if (!response.ok) { if ([401,403,404].includes(response.status)) { onForbidden(); return } if (response.status === 409) setConflict(true); throw Error(data.error || "Unable to change the creation office.") }
      toast.success("Creation office updated."); onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to confirm the change. Reload before trying again."); setView(null); reload() }
    finally { setSaving(false) }
  }}>
    <p className="text-sm text-muted-foreground">This preference does not grant access, move saved records or change report filters. Open forms keep their captured office and may need reopening after a change.</p>
    <FormField id="workspace-office" label="Office for new records"><SearchableSelect id="workspace-office" value={officeId ?? "none"} selectedOption={{ value: officeId ?? "none", label: officeId ? selected ? label(selected) : "Unavailable office selection" : "No creation office" }} placeholder="Choose an office" disabled={saving} options={[{ value: "none", label: "No creation office" },...(ready ? view.items.map(office => ({ value: office.id, label: label(office) })) : [])]} onChange={value => setOfficeId(value === "none" ? null : value)} onSearchChange={next => { setQ(next); if (next !== q) setPage(1) }} /></FormField>
    {choiceError && <p role="alert" className="text-sm text-destructive">{choiceError}</p>}
    {ready && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{view.total} eligible {view.total === 1 ? "office" : "offices"}</span>{view.totalPages > 1 && <><Button type="button" size="sm" variant="ghost" disabled={saving || page <= 1} onClick={() => setPage(page-1)} aria-label="Previous workspace choices">Previous</Button><span>{page} / {view.totalPages}</span><Button type="button" size="sm" variant="ghost" disabled={saving || page >= view.totalPages} onClick={() => setPage(page+1)} aria-label="Next workspace choices">Next</Button></>}</div>}
    {ready && officeId && !view.selected && <p role="alert" className="text-sm text-destructive">This office is no longer eligible. Choose another office or No creation office.</p>}
    {ready && !view.total && <p className="text-sm text-muted-foreground">{q ? "No offices match your search." : "No eligible active offices. Ask your administrator to review office membership."}</p>}
  </DraftPanel>
}
