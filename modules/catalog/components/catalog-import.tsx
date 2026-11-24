"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { Surface, pageClass } from "@/components/erp/page"
import { RecordTabs } from "@/components/erp/record-detail"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { InfoHelp } from "@/components/erp/info-help"
import { useListState } from "@/components/erp/list-navigation"
import { AccessPageHeader } from "@/platform/access/record-page"
import { IMPORT_MAX_BYTES } from "@/platform/imports/types"
type Progress = { id: string; status: string; counts: Record<string, number> }
type Result = Progress & { canProcess: boolean; defaultCurrency: string | null; templateVersion: number; fileName: string; profile: string; total: number; items: { rowNumber: number; values: string[]; status: string; errors: { field: string; message: string }[] }[] }
type History = { items: { id: string; fileName: string; profile: string; status: string }[]; total: number }
const labels: Record<string, string> = { PENDING: "To validate", READY: "Ready", INVALID: "Needs correction", DUPLICATE: "Duplicate", IMPORTED: "Imported", VALIDATING: "Validating", REVIEW: "Ready for review", IMPORTING: "Importing", COMPLETE: "Complete" }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" }), result = await response.json()
  if (!response.ok) throw Error(result.error || "Unable to complete import.")
  return result
}
export function CatalogImport() {
  const [selection, setSelection] = useListState("catalog-import", "selection", { id: "", page: 1 })
  const [tab, setTab] = React.useState("upload"), [profile, setProfile] = React.useState("catalog")
  const [options, setOptions] = React.useState<{ key: string; label: string }[]>([]), [file, setFile] = React.useState<File | null>(null)
  const [result, setResult] = React.useState<Result>(), [summary, setSummary] = React.useState<Progress>(), [history, setHistory] = React.useState<History>({ items: [], total: 0 }), [historyPage, setHistoryPage] = React.useState(1)
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [confirm, setConfirm] = React.useState(false)
  const stopped = React.useRef(false), active = React.useRef(false), mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true } }, [])
  React.useEffect(() => {
    const controller = new AbortController()
    api<{ items: { key: string; label: string }[] }>("/api/catalog/imports/options", { signal: controller.signal }).then(data => setOptions(data.items)).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])
  React.useEffect(() => {
    if (!selection.id) { setResult(undefined); return }
    const controller = new AbortController()
    api<Result>(`/api/catalog/imports/${encodeURIComponent(selection.id)}?page=${selection.page}`, { signal: controller.signal }).then(data => { setResult(data); setProfile(data.profile); if (!active.current) setSummary(data); setTab("review") }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setResult(undefined) } })
    return () => controller.abort()
  }, [selection.id, selection.page])
  React.useEffect(() => {
    if (tab !== "history") return
    const controller = new AbortController()
    api<History>(`/api/catalog/imports?page=${historyPage}`, { signal: controller.signal }).then(setHistory).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [tab, historyPage])
  async function refresh(id = selection.id, page = selection.page) {
    const data = await api<Result>(`/api/catalog/imports/${encodeURIComponent(id)}?page=${page}`)
    if (mounted.current) { setResult(data); setSummary(data) }
  }
  async function process(id: string, action: "validate" | "import") {
    let next: Progress
    do {
      next = await api<Progress>(`/api/catalog/imports/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
      if (mounted.current) setSummary(next)
    } while (!stopped.current && mounted.current && next.status === (action === "validate" ? "VALIDATING" : "IMPORTING"))
    if (mounted.current) await refresh(id, id === selection.id ? selection.page : 1)
  }
  async function work(action: () => Promise<void>) {
    if (active.current) return
    active.current = true; stopped.current = false; setBusy(true); setError("")
    try { await action() } catch (e) { if (mounted.current) setError((e as Error).message) }
    finally { active.current = false; if (mounted.current) { setBusy(false); setConfirm(false) } }
  }
  async function upload() {
    if (!file) return
    const form = new FormData(); form.set("file", file); form.set("profile", profile)
    const data = await api<Progress>("/api/catalog/imports", { method: "POST", body: form })
    setSelection({ id: data.id, page: 1 }); setSummary(data); setTab("review")
    await process(data.id, "validate")
  }
  const current = summary?.id === selection.id ? summary : result
  const correctionCount = (current?.counts.INVALID || 0) + (current?.counts.DUPLICATE || 0)
  const total = Object.values(current?.counts || {}).reduce((sum, count) => sum + count, 0)
  const done = total - (current?.counts[current.status === "VALIDATING" ? "PENDING" : "READY"] || 0)
  const tableClass = "w-full text-left text-sm [&_th]:p-3 [&_td]:p-3 [&_tr]:border-b"
  return <div className={pageClass}>
    <AccessPageHeader title="Import products and units" backHref="/catalog" description="Download the standard template, fill Items and validate it. Import creates new inventory only. Existing codes, errors and duplicates go into the correction file." />
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    <RecordTabs value={tab} onChange={setTab} tabs={[
      { value: "upload", label: "1. Upload", content: <Surface>
        <div className="grid gap-5 sm:grid-cols-2"><label className="space-y-2"><span className="block font-medium">Template</span><Select aria-label="Import template" value={profile} disabled={busy} onValueChange={setProfile}>{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</Select></label><div className="flex items-end"><Button asChild variant="outline" disabled={!options.length || busy}><a href={`/api/catalog/imports/template?profile=${encodeURIComponent(profile)}`}>Download Excel template</a></Button></div></div>
        <p className="text-sm text-muted-foreground">Fill the Items sheet. Keep the column headings unchanged. Up to 1,000 rows, CSV or XLSX, 3 MB.</p>
        <label className="block space-y-2"><span className="font-medium">Completed template</span><Input aria-label="Completed template" type="file" accept=".csv,.xlsx" disabled={busy} onChange={event => {
          const selected = event.target.files?.[0]; setFile(null); setError("")
          if (selected && (!selected.size || selected.size > IMPORT_MAX_BYTES || !/\.(csv|xlsx)$/i.test(selected.name))) { setError("Choose a non-empty CSV or XLSX file up to 3 MB."); event.target.value = ""; return }
          setFile(selected || null)
        }} /></label>
        <Button disabled={!file || busy || !options.length} loading={busy} onClick={() => work(upload)}>Validate file</Button>
      </Surface> },
      { value: "review", label: "2. Review and import", content: !result || !current ? <Surface><p>Upload a template or open a saved import.</p></Surface> : <Surface>
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><h2 className="min-w-0 break-all font-semibold">{result.fileName}</h2><InfoHelp title="Import rules">New inventory only. Existing item codes are skipped. Setup, permissions and references are checked again during import. Correct downloaded error rows, keep their headings, and upload them as a new file.</InfoHelp></div><span role="status">{labels[current.status]}</span></div>
        {result.defaultCurrency && <p className="text-sm">Currency for blank cells: {result.defaultCurrency}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{["PENDING", "READY", "INVALID", "DUPLICATE", "IMPORTED"].map(status => <div key={status} className="rounded-lg border p-3"><span className="text-sm text-muted-foreground">{labels[status]}</span><strong className="block text-xl">{current.counts[status] || 0}</strong></div>)}</div>
        {busy && <div className="space-y-2"><progress aria-label="Import progress" max={Math.max(1, total)} value={done} className="w-full" /><p className="text-sm">{current.status === "VALIDATING" ? "Validating" : "Processing"} rows. Progress is saved after each batch.</p></div>}
        <div className="flex flex-wrap items-center gap-2">
          {!result.canProcess && <p role="status">This earlier import is read-only. Download the current template and re-upload any remaining rows.</p>}{current.status === "VALIDATING" && <Button disabled={busy || !result.canProcess} onClick={() => work(() => process(result.id, "validate"))}>Resume validation</Button>}
          {["REVIEW", "IMPORTING"].includes(current.status) && <Button disabled={busy || !result.canProcess || !(current.counts.READY > 0)} onClick={() => setConfirm(true)}>{current.status === "IMPORTING" ? "Resume import" : "Import valid rows"}</Button>}
          {busy && <Button variant="outline" onClick={() => { stopped.current = true }}>Pause after this batch</Button>}
          {!!correctionCount && <Button variant="outline" asChild><a href={`/api/catalog/imports/${result.id}/errors`}>Download corrections ({correctionCount})</a></Button>}
          <Button variant="outline" disabled={busy} onClick={() => work(() => refresh())}>Refresh</Button>
        </div>
        <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>Row</th><th>Code</th><th>Name</th><th>Result</th><th>Issues</th></tr></thead><tbody>{result.items.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.values[0]}</td><td className="max-w-64 break-words">{row.values[1]}</td><td>{labels[row.status]}</td><td className="min-w-48 max-w-96 break-words">{row.errors.map(issue => `${issue.field}: ${issue.message}`).join("; ") || "-"}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{result.total} rows | Page {selection.page} of {Math.max(1, Math.ceil(result.total / 20))}</span><div className="flex gap-2"><Button variant="outline" disabled={busy || selection.page <= 1} onClick={() => setSelection({ ...selection, page: selection.page - 1 })}>Previous</Button><Button variant="outline" disabled={busy || selection.page * 20 >= result.total} onClick={() => setSelection({ ...selection, page: selection.page + 1 })}>Next</Button></div></div>
      </Surface> },
      { value: "history", label: "Saved imports", content: <Surface>
        <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>File</th><th>Template</th><th>Status</th><th /></tr></thead><tbody>{history.items.map(row => <tr key={row.id}><td className="break-all">{row.fileName}</td><td>{options.find(option => option.key === row.profile)?.label || row.profile}</td><td>{labels[row.status]}</td><td><Button variant="outline" disabled={busy} onClick={() => { setSelection({ id: row.id, page: 1 }); setTab("review") }}>Open</Button></td></tr>)}</tbody></table></div>
        {!history.items.length && <p>No saved imports.</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => p - 1)}>Previous</Button><Button variant="outline" disabled={historyPage * 20 >= history.total} onClick={() => setHistoryPage(p => p + 1)}>Next</Button></div>
      </Surface> },
    ]} />
    {confirm && result && <ConfirmAction title="Import valid inventory rows?" description={`${current?.counts.READY || 0} ready rows will create new items. Invalid and duplicate rows are skipped. Existing items will not be updated.`} label="Confirm import" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => work(() => process(result.id, "import"))} />}
  </div>
}
