"use client"
import * as React from "react"
import { type ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { Upload, Download, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/data-table"
import { SearchableSelect } from "@/components/searchable-select"
import { FormField } from "@/components/form-field"
import { CrmPageHeader, crmPageClass } from "./crm-page"
import { CrmSection } from "./crm-section"
import { CrmPagination } from "./crm-pagination"
import { CrmSelect } from "./crm-controls"
import { importReportColumns, IMPORT_MAX_BYTES, type ImportConfig, type ImportField, type ImportIssue } from "../import-types"

type Row = { rowNumber: number; values: string[]; status: string; errors: ImportIssue[] }
type Batch = { id: string; fileName: string; headers: string[]; status: string; fields: ImportField[]; config: ImportConfig; counts: Record<string, number>; items: Row[]; total: number; page: number; pageSize: number; totalPages: number }
type History = { items: { id: string; fileName: string; status: string; createdAt: string; _count: { rows: number } }[]; total: number; page: number }
const endpoint = "/api/crm/enquiry-imports"
const labels: Record<string, string> = { MAPPING: "Map columns", VALIDATING: "Validating", REVIEW: "Ready for review", IMPORTING: "Importing", COMPLETE: "Complete", PENDING: "Pending", READY: "Ready", INVALID: "Error", DUPLICATE: "Duplicate", IMPORTED: "Imported" }
function ImportStatus({ value }: { value: string }) { return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${value === "INVALID" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}>{labels[value]}</span> }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || "Unable to complete this request. Try again.")
  return body
}
const body = (method: string, data: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })

export function EnquiryImport() {
  const [batch, setBatch] = React.useState<Batch | null>(null)
  const [config, setConfig] = React.useState<ImportConfig>({ mapping: {}, defaults: {} })
  const [history, setHistory] = React.useState<History>({ items: [], total: 0, page: 1 })
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [result, setResult] = React.useState("all")
  const stopped = React.useRef(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const handleError = (e: unknown) => setError(e instanceof Error ? e.message : "Unable to complete this request.")
  async function refreshHistory(page = 1) { setHistory(await request<History>(`${endpoint}?page=${page}&pageSize=10`)) }
  async function open(id: string, page = 1, filter = "all", size = 20) {
    const data = await request<Batch>(`${endpoint}/${id}?page=${page}&pageSize=${size}&result=${filter}`)
    setBatch(data); setConfig(data.config); setResult(filter)
    window.history.replaceState(null, "", `?batch=${encodeURIComponent(id)}`)
    return data
  }
  React.useEffect(() => {
    stopped.current = false
    const id = new URLSearchParams(window.location.search).get("batch")
    refreshHistory().catch(handleError)
    if (id) open(id).catch(handleError)
    return () => { stopped.current = true }
  }, [])
  async function act(work: () => Promise<void>) {
    setBusy(true); setError("")
    try { await work() } catch (e) { if (!stopped.current) handleError(e) }
    finally { if (!stopped.current) setBusy(false) }
  }
  async function upload() {
    if (!file) return
    await act(async () => {
      if (file.size > IMPORT_MAX_BYTES) throw new Error("Choose a file up to 3 MB.")
      const form = new FormData(); form.set("file", file)
      const data = await request<Batch>(endpoint, { method: "POST", body: form })
      setBatch(data); setConfig(data.config); setResult("all")
      window.history.replaceState(null, "", `?batch=${data.id}`)
      await refreshHistory()
    })
  }
  async function process(action: "validate" | "import") {
    if (!batch) return
    await act(async () => {
      let next = batch
      if (next.status === "MAPPING") next = await request<Batch>(`${endpoint}/${next.id}`, body("PUT", config))
      setBatch(next); setResult("all")
      do {
        next = await request<Batch>(`${endpoint}/${next.id}`, body("POST", { action }))
        if (stopped.current) return
        setBatch(next)
      } while (next.status === "VALIDATING" || next.status === "IMPORTING")
      await refreshHistory()
    })
  }
  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { id: "row", header: "Row", accessorKey: "rowNumber" },
    { id: "status", header: "Result", cell: ({ row }) => <ImportStatus value={row.original.status} /> },
    { id: "errors", header: "What to correct", cell: ({ row }) => <div className="min-w-52 max-w-md whitespace-normal text-sm">{row.original.errors.map((e, i) => <p key={i}><span className="font-medium">{e.field}:</span> {e.message}</p>)}</div> },
    ...(batch?.headers || []).filter(h => !importReportColumns.includes(h)).map(h => ({ id: `column-${h}`, header: h, cell: ({ row }: { row: { original: Row } }) => <span className="block max-w-64 truncate" title={row.original.values[batch!.headers.indexOf(h)]}>{row.original.values[batch!.headers.indexOf(h)]}</span> })),
  ], [batch])
  const table = useReactTable({ data: batch?.items || [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true })
  const ready = batch?.counts.READY || 0, failed = (batch?.counts.INVALID || 0) + (batch?.counts.DUPLICATE || 0)
  const totalRows = Object.values(batch?.counts || {}).reduce((sum, n) => sum + n, 0)
  const defaults = (batch?.fields || []).filter(f => ["assignedUserId", "salesTeamId", "sourceId", "projectId", "subprojectId"].includes(f.key))
  function newUpload() { setBatch(null); setFile(null); setError(""); window.history.replaceState(null, "", window.location.pathname) }
  function defaultChanged(key: string, value: string) {
    setConfig(old => ({ ...old, defaults: { ...old.defaults, [key]: value, ...(key === "projectId" ? { subprojectId: "" } : {}) } }))
  }
  return <section className={crmPageClass}>
    <CrmPageHeader title="Import enquiries" description="Upload a sheet, check its rows, then import new enquiries. Existing contacts are never updated." backHref="/crm/enquiries" backLabel="Back to enquiries" actions={batch && <Button variant="outline" disabled={busy} onClick={newUpload}>Upload another sheet</Button>} />
    <ol className="grid grid-cols-3 gap-2 text-sm" aria-label="Import steps">{["1. Upload", "2. Map and review", "3. Import"].map((step, i) => <li key={step} className={`rounded-lg border p-3 ${(!batch ? i === 0 : batch.status === "COMPLETE" || batch.status === "IMPORTING" ? i === 2 : i === 1) ? "border-primary bg-muted font-medium" : "text-muted-foreground"}`}>{step}</li>)}</ol>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
    {!batch ? <>
      <CrmSection title="Upload your sheet" description="CSV or XLSX, up to 1,000 rows and 3 MB. For Excel, use the first sheet." actions={<Button variant="outline" asChild><a href={`${endpoint}/template`} download><Download className="size-4" />Download CSV template</a></Button>}>
        <p className="text-sm text-muted-foreground">Download the template, fill in your enquiries in Excel or Google Sheets, then save as CSV UTF-8 and upload it here. Keep the headings; leave optional columns blank. Format phone cells as Text to keep the + country code.</p>
        <p className="text-sm text-muted-foreground">Include Contact name and Email or Phone. Phone numbers need a country code, such as +919876543210. Dates use YYYY-MM-DD. An enquiry title is generated if it is blank.</p>
        <FormField label="Enquiry file" id="enquiry-file"><Input ref={fileInput} id="enquiry-file" type="file" accept=".csv,.xlsx" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} /></FormField>
        <div className="flex justify-end"><Button onClick={upload} disabled={!file || busy} loading={busy}><Upload className="size-4" /> Upload and map fields</Button></div>
      </CrmSection>
      <CrmSection title="Your imports" description="Open an import to resume processing or download its correction sheet.">
        {!history.items.length ? <p className="text-sm text-muted-foreground">No imports yet.</p> : <ul className="divide-y">{history.items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{item.fileName}</p><p className="text-sm text-muted-foreground">{item._count.rows} rows · {labels[item.status]}</p></div><Button variant="outline" disabled={busy} onClick={() => act(async () => { await open(item.id) })}>Open import</Button></li>)}</ul>}
        <CrmPagination page={history.page} pageSize={10} total={history.total} loading={busy} onPageChange={p => act(() => refreshHistory(p))} />
      </CrmSection>
    </> : <>
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{batch.fileName} · {totalRows} rows</span><ImportStatus value={batch.status} /></div>
      {batch.status === "MAPPING" ? <>
        <CrmSection title="Match your columns" description="Check suggested matches. Leave unused columns set to Skip column.">
          <div className="hidden grid-cols-[1fr_1fr] gap-4 border-b pb-2 text-sm font-medium sm:grid"><span>Column in your sheet</span><span>Enquiry field</span></div>
          {batch.headers.map((header, index) => {
            const selected = Object.keys(config.mapping).find(k => config.mapping[k] === index) || ""
            const options = batch.fields.filter(f => config.mapping[f.key] === undefined || f.key === selected).map(f => ({ value: f.key, label: f.label }))
            return <div key={index} className="grid items-center gap-2 sm:grid-cols-2 sm:gap-4"><div className="min-w-0"><label htmlFor={`map-${index}`} className="text-sm font-medium">{header}</label><p className="truncate text-xs text-muted-foreground" title={batch.items[0]?.values[index]}>Example: {batch.items[0]?.values[index] || "(empty)"}</p></div><SearchableSelect id={`map-${index}`} value={selected || "skip"} options={[{ value: "skip", label: "Skip column" }, ...options]} placeholder="Select a field" disabled={busy} onChange={key => setConfig(old => { const mapping = { ...old.mapping }; if (selected) delete mapping[selected]; if (key !== "skip") mapping[key] = index; return { ...old, mapping } })} /></div>
          })}
        </CrmSection>
        <CrmSection title="Defaults for this import" description="Used when a column is unmapped or its cell is blank. All enquiries start as New.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{defaults.map(field => <FormField key={field.key} id={`default-${field.key}`} label={field.label}><SearchableSelect id={`default-${field.key}`} value={config.defaults[field.key] || field.defaultValue || "none"} options={[{ value: "none", label: field.required ? "Choose a salesperson" : "Not specified" }, ...(field.choices || []).filter(c => field.key !== "subprojectId" || c.parentId === config.defaults.projectId).map(c => ({ value: c.id, label: c.name }))]} placeholder="Choose a value" disabled={busy} onChange={value => defaultChanged(field.key, value === "none" ? "" : value)} /></FormField>)}</div>
          <div className="flex justify-end"><Button disabled={busy} loading={busy} onClick={() => process("validate")}>Validate rows</Button></div>
        </CrmSection>
      </> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Ready", ready], ["Errors", batch.counts.INVALID || 0], ["Duplicates", batch.counts.DUPLICATE || 0], ["Imported", batch.counts.IMPORTED || 0]].map(([label, n]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{n}</p></div>)}</div>
        <CrmSection title={batch.status === "COMPLETE" ? "Import results" : "Review your rows"} description="Duplicate emails or phone numbers are skipped, including duplicates already in this business. No existing records are updated.">
          {batch.status === "COMPLETE" && <p role="status" className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4" />{batch.counts.IMPORTED || 0} {batch.counts.IMPORTED === 1 ? "enquiry" : "enquiries"} imported. {failed} {failed === 1 ? "row" : "rows"} skipped.</p>}
          {(busy || batch.status === "VALIDATING" || batch.status === "IMPORTING") && <p role="status" className="text-sm text-muted-foreground">{busy ? "Processing" : "Processing paused"} · {batch.status === "VALIDATING" ? totalRows - (batch.counts.PENDING || 0) : batch.counts.IMPORTED || 0} rows processed. You can reopen this import to resume.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CrmSelect aria-label="Show import rows" value={result} disabled={busy} onValueChange={v => act(async () => { await open(batch.id, 1, v, batch.pageSize) })}><option value="all">All rows</option><option value="errors">Errors and duplicates</option></CrmSelect>
            <div className="flex flex-wrap gap-2">{failed > 0 && ["REVIEW", "COMPLETE"].includes(batch.status) && <Button variant="outline" asChild><a href={`${endpoint}/${batch.id}/errors`} download><Download className="size-4" />Download correction sheet</a></Button>}
              {batch.status === "REVIEW" && <Button disabled={busy} loading={busy} onClick={() => process("import")}>{ready ? `Import ${ready} ready ${ready === 1 ? "row" : "rows"}` : "Finish import"}</Button>}
              {["VALIDATING", "IMPORTING"].includes(batch.status) && <Button disabled={busy} loading={busy} onClick={() => process(batch.status === "VALIDATING" ? "validate" : "import")}>Resume {batch.status === "VALIDATING" ? "validation" : "import"}</Button>}
            </div>
          </div>
          <DataTable table={table} emptyMessage="No rows in this view." />
          <CrmPagination page={batch.page} pageSize={batch.pageSize} total={batch.total} totalPages={batch.totalPages} loading={busy} onPageChange={p => act(async () => { await open(batch.id, p, result, batch.pageSize) })} onPageSizeChange={size => act(async () => { await open(batch.id, 1, result, size) })} />
          {failed > 0 && <p className="text-sm text-muted-foreground">Correct invalid rows, remove genuine duplicates, then choose Upload another sheet. Unchanged duplicates will be skipped again.</p>}
        </CrmSection>
      </>}
    </>}
  </section>
}
