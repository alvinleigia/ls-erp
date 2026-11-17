"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import type { VerificationSubject } from "./contracts"
import { VerificationSubmissions } from "./submission-controls"
import { VerificationRetentionControls } from "./retention-controls"
import type { EvidenceMetadata } from "./evidence-contracts"
import { ImageFileInput } from "@/components/uploads/image-file-input"
import { uploadFileWithProgress } from "@/components/uploads/upload-file"

type View = { canReadHolds: boolean; status: string; reviewStatusAvailable: boolean; canReadSubmissions: boolean; case: { id: string } | null; documents: { code: string; label: string }[]; canStart: boolean; canUpload: boolean; canCancel: boolean; canCleanup: boolean; canReadEvidence: boolean; evidence: EvidenceMetadata[]; pending: EvidenceMetadata[]; policyVersion: number; fileLimit: number }
async function request(path: string, data?: unknown) {
  const response = await fetch(path, { method: data === undefined ? "GET" : "POST", cache: "no-store", ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Unable to complete verification action.")
  return result
}
export function VerificationCollection({ kind, id }: VerificationSubject) {
  const [view, setView] = React.useState<View>(), [reload, setReload] = React.useState(0), [error, setError] = React.useState(""), [busy, setBusy] = React.useState(false)
  const [retentionOpened, setRetentionOpened] = React.useState(false)
  const [tab, setTab] = React.useState("evidence"), [reviewOpened, setReviewOpened] = React.useState(false)
  const [documentCode, setDocumentCode] = React.useState(""), [file, setFile] = React.useState<File | null>(null), [inputKey, setInputKey] = React.useState(0), [progress, setProgress] = React.useState("")
  const [uploadPercent, setUploadPercent] = React.useState<number | null>(null)
  React.useEffect(() => { setFile(null); setInputKey(n => n + 1); setProgress(""); setUploadPercent(null) }, [kind, id])
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/verification/collection?${new URLSearchParams({ kind, id })}`, { cache: "no-store", signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw Error(data.error || "Unable to load verification.")
      if (!controller.signal.aborted) { setView(data); setDocumentCode(code => data.documents.some((d: { code: string }) => d.code === code) ? code : data.documents[0]?.code ?? "") }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [kind, id, reload])
  async function act(work: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError(""); setProgress("")
    try { await work(); setReload(n => n + 1) }
    catch (e) { setProgress(""); setError(e instanceof Error ? e.message : "Unable to complete this action.") }
    finally { setBusy(false); setUploadPercent(null) }
  }
  async function uploadFile() {
    if (!view?.case || !file) return
    if (!file.size || file.size > view.fileLimit || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) throw Error("Choose a PDF, JPEG or PNG up to 5 MB.")
    const upload = await request("/api/verification/evidence/uploads", { caseId: view.case.id, documentCode, filename: file.name, bytes: file.size, contentType: file.type })
    setProgress("Uploading file…")
    try {
      await uploadFileWithProgress(upload.uploadUrl, file, { "Content-Type": file.type, "x-upsert": "false", "cache-control": "max-age=0" }, setUploadPercent)
      setUploadPercent(null)
      setProgress("Validating file…")
      await request(`/api/verification/evidence/${upload.id}/finalize`, {})
    } finally { setReload(n => n + 1) }
    setFile(null); setInputKey(n => n + 1); setProgress("Evidence uploaded. This does not approve the customer.")
  }
  return <Section title="Customer verification" help="Private originals: PDF/JPEG/PNG, 5 MB each, up to 20 uncleaned files per case. Uploading does not verify identity or approve a booking. Only authorised evidence readers can download files; bearer download links expire after 60 seconds. Customer correspondence and issued PDFs remain separate.">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {uploadPercent !== null && <div className="flex items-center gap-3"><div role="progressbar" aria-label="Evidence upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadPercent} className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${uploadPercent}%` }} /></div><span aria-hidden="true" className="text-sm tabular-nums">{uploadPercent}%</span></div>}
    {!view && !error && <p>Loading verification…</p>}
    {view && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium">{view.case ? (view.reviewStatusAvailable ? view.status.toLowerCase().replaceAll("_", " ") : "Case started - private review status") : "Not started"}</span><Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setReload(n => n + 1) }}>Refresh verification</Button></div>
      {!view.policyVersion && <p>Ask a tenant administrator to publish verification requirements before collection.</p>}
      {!view.case && view.canStart && <Button type="button" disabled={busy || !view.policyVersion} loading={busy} onClick={() => void act(() => request("/api/verification/cases", { kind, id }))}>Start verification</Button>}
      {view.case && (view.canReadSubmissions || view.canReadHolds) && <div role="tablist" aria-label="Verification sections" className="flex gap-2 overflow-x-auto border-b pb-2 [&>button]:shrink-0">{[["evidence", "Evidence"], ...(view.canReadSubmissions ? [["review", "Facts and review"]] : []), ...(view.canReadHolds ? [["retention", "Retention and holds"]] : [])].map(([value, label]) => <Button key={value} type="button" role="tab" aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} onClick={() => { setTab(value); if (value === "evidence") setReload(n => n + 1); if (value === "review") setReviewOpened(true); if (value === "retention") setRetentionOpened(true) }}>{label}</Button>)}</div>}
      <div hidden={tab !== "evidence"} className="space-y-4">
      {view.case && view.canUpload && <div className="space-y-3 rounded-lg border p-4">
        {!view.documents.length ? <p>No document types are configured for this customer type.</p> : <>
          <div className="grid items-end gap-3 sm:grid-cols-2"><div className="space-y-1"><label htmlFor="verification-document" className="block text-sm font-medium">Document type</label><Select id="verification-document" value={documentCode} disabled={busy} className="w-full" onValueChange={setDocumentCode}>{view.documents.map(d => <option value={d.code} key={d.code}>{d.label}</option>)}</Select></div><div className="space-y-1"><label htmlFor="verification-file" className="block text-sm font-medium">Evidence file (up to 5 MB)</label><ImageFileInput key={inputKey} id="verification-file" value={file} maxBytes={view.fileLimit} accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={setFile} /></div></div>
          <Button type="button" disabled={busy || !file || !documentCode} loading={busy} onClick={() => void act(uploadFile)}>Upload evidence</Button>
        </>}
      </div>}
      {!!view.pending.length && <div className="space-y-2"><h3 className="font-medium">Your unfinished uploads</h3>{view.pending.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span className="min-w-0 break-all text-sm">{row.filename}</span><div className="flex flex-wrap gap-2">{view.canUpload && <Button type="button" variant="outline" disabled={busy} onClick={() => void act(() => request(`/api/verification/evidence/${row.id}/finalize`, {}))}>Retry validation</Button>}{view.canCancel && <Button type="button" variant="ghost" disabled={busy} onClick={() => void act(() => request(`/api/verification/evidence/${row.id}/cancel`, {}))}>Cancel upload</Button>}</div></div>)}</div>}
      <div className="space-y-2"><h3 className="font-medium">Uploaded evidence</h3>{!view.canReadEvidence ? <p className="text-sm text-muted-foreground">Private evidence requires a separate viewing permission.</p> : !view.evidence.length ? <p className="text-sm text-muted-foreground">No accepted files yet.</p> : view.evidence.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{row.filename}</p><p className="text-xs text-muted-foreground">{view.documents.find(d => d.code === row.documentCode)?.label ?? row.documentCode} · {Math.ceil(row.bytes / 1024)} KB · accepted upload</p></div><Button asChild variant="outline"><a href={`/api/verification/evidence/${row.id}/download`} target="_blank" rel="noopener noreferrer">Download evidence</a></Button></div>)}</div>
      {view.canCleanup && view.canReadEvidence && view.canReadHolds && <Button type="button" variant="outline" disabled={busy} onClick={() => { setTab("retention"); setRetentionOpened(true) }}>Manage uploaded files</Button>}
      {view.canCleanup && <Button type="button" variant="ghost" disabled={busy} onClick={() => void act(async () => { const result = await request("/api/verification/evidence/cleanup", {}); setProgress(`Cleaned ${result.cleaned} expired, unaccepted uploads across this business. Accepted evidence was retained.`) })}>Clean expired business uploads</Button>}
      </div>
      {view.case && view.canReadSubmissions && reviewOpened && <div hidden={tab !== "review"}><VerificationSubmissions kind={kind} id={id} changed={reload} onChanged={() => setReload(n => n + 1)} /></div>}
      {view.case && view.canReadHolds && retentionOpened && <div hidden={tab !== "retention"}><VerificationRetentionControls kind={kind} id={id} changed={reload} /></div>}
    </>}
  </Section>
}
