"use client"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { Section } from "@/components/erp/section"
import { EditPanel } from "@/components/erp/record-detail"
import { Pagination } from "@/components/erp/pagination"
import { useListState } from "@/components/erp/list-navigation"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { toast } from "sonner"

type Phase = { id: string; name: string; code: string; status: string; opensAt: string | null; version: number }
type Result = { items: Phase[]; total: number; page: number; pageSize: number; totalPages: number; projectName: string; canManage: boolean }
const labels: Record<string, string> = { PLANNED: "Planned", OPEN: "Open", PAUSED: "Paused", CLOSED: "Closed" }
const empty: Phase = { id: "", name: "", code: "", status: "PLANNED", opensAt: null, version: 1 }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json()
  if (!response.ok) throw Error(data.error || "Unable to load launch phases.")
  return data
}
const localTime = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""

export function LaunchPhases({ projectId }: { projectId: string }) {
  const [page, setPage] = useListState("launch-phases", "page", 1)
  const [data, setData] = useState<Result>(), [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Phase | null>(null), [saved, setSaved] = useState<Phase | null>(null), [opensAt, setOpensAt] = useState("")
  const { formatDateTime } = useDateFormatter()
  const endpoint = `/api/real-estate/projects/${projectId}/launch-phases`
  const load = useCallback(async (signal?: AbortSignal) => { setData(await request<Result>(`${endpoint}?page=${page}`, { signal })) }, [endpoint, page])
  useEffect(() => { const controller = new AbortController(); setError(""); void load(controller.signal).catch(e => { if (!controller.signal.aborted) { setData(undefined); setError(e.message) } }); return () => controller.abort() }, [load])
  function edit(row: Phase) { setError(""); setSaved(row); setDraft({ ...row }); setOpensAt(localTime(row.opensAt)) }
  async function save() {
    if (!draft) return
    if (!draft.name.trim() || !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(draft.code.trim().toUpperCase())) { setError("Enter a name and a code using letters, numbers, hyphens or underscores."); return }
    if (opensAt && !Number.isFinite(new Date(opensAt).getTime())) { setError("Choose a valid opening date and time."); return }
    setBusy(true); setError("")
    try {
      await request(`${endpoint}${draft.id ? `/${draft.id}` : ""}`, { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, code: draft.code, status: draft.status, opensAt: opensAt ? new Date(opensAt).toISOString() : null, ...(draft.id ? { version: draft.version } : {}) }) })
      setDraft(null); toast.success("Launch phase saved"); await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Section title="Launch phases" help={<>Phases control when assigned units can receive new reservations. They are separate from buildings, blocks and other subprojects. Open permits new holds after the optional opening time. Planned, Paused and Closed block new holds. Existing reservations, allocations and payments continue. Units without a phase keep their current availability.</>} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setError(""); void load().catch(e => setError(e.message)) }}>Refresh phases</Button>{data?.canManage && <Button onClick={() => edit(empty)}>New launch phase</Button>}</div>}>
    {error && !draft && <p role="alert" className="text-destructive">{error}</p>}
    {!data && !error && <p>Loading launch phases…</p>}
    {data && <div className="space-y-4"><p className="text-sm text-muted-foreground">Shared across {data.projectName} and its subprojects.</p>
      {!data.items.length ? <p>No launch phases. Units keep their current availability until assigned to a phase.</p> : <div className="divide-y rounded-lg border">{data.items.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-words font-medium">{row.name} <span className="text-sm font-normal text-muted-foreground">({row.code})</span></p><p className="text-sm">{labels[row.status]}{row.opensAt && ` · Opens no earlier than ${formatDateTime(row.opensAt)}`}</p></div>{data.canManage && <Button variant="outline" onClick={() => edit(row)} aria-label={`Edit ${row.name}`}>Edit</Button>}</article>)}</div>}
      <Pagination {...data} onPageChange={setPage} label="Launch phases pagination" />
    </div>}
    <EditPanel open={!!draft} title={draft?.id ? "Edit launch phase" : "New launch phase"} description="Assign units to this phase from their catalog details. Changes affect new reservations only." onClose={() => { setDraft(null); setError("") }} onSubmit={() => void save()} saving={busy} error={error} dirty={JSON.stringify(draft) !== JSON.stringify(saved) || opensAt !== localTime(saved?.opensAt || null)}>
      {draft && <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="phase-name" label="Phase name"><Input id="phase-name" required maxLength={160} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></FormField>
        <FormField id="phase-code" label="Phase code"><Input id="phase-code" required maxLength={40} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} /></FormField>
        <FormField id="phase-status" label="Booking status"><Select id="phase-status" value={draft.status} onValueChange={status => setDraft({ ...draft, status })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
        <FormField id="phase-opens" label="Opening date and time (optional)" help="Uses this browser’s time zone. The phase must also be Open. No background job is needed."><Input id="phase-opens" type="datetime-local" value={opensAt} onChange={e => setOpensAt(e.target.value)} /></FormField>
      </div>}
    </EditPanel>
  </Section>
}
