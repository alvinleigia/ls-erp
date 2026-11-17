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
import { ArrowRight, RefreshCw } from "lucide-react"
import { ConfirmAction } from "@/components/erp/confirm-action"

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
  const [confirmCleanup, setConfirmCleanup] = React.useState(false), panelId = React.useId(), reviewPanel = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { setView(undefined); setFile(null); setInputKey(n => n + 1); setProgress(""); setUploadPercent(null); setTab("evidence"); setReviewOpened(false); setRetentionOpened(false); setConfirmCleanup(false) }, [kind, id])
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
    setFile(null); setInputKey(n => n + 1); setProgress("Document uploaded.")
  }
  function openTab(value: string) {
    setTab(value)
    if (value === "evidence") setReload(n => n + 1)
    if (value === "review") setReviewOpened(true)
    if (value === "retention") setRetentionOpened(true)
  }
  const statusLabel = !view?.case ? "Not started" : !view.reviewStatusAvailable ? "Verification started" : ({ IN_PROGRESS: "Collecting documents", UNDER_REVIEW: "Awaiting review", VERIFIED: "Verified", CHANGES_REQUIRED: "Corrections needed", EXPIRED: "Verification expired", REVOKED: "Approval revoked", REVIEW_REQUIRED: "Fresh review needed" }[view.status] ?? view.status.toLowerCase().replaceAll("_", " "))
  return <Section title="Customer verification" actions={<Button type="button" variant="ghost" size="sm" aria-label="Refresh verification" disabled={busy} onClick={() => { setError(""); setReload(n => n + 1) }}><RefreshCw aria-hidden="true" />Refresh</Button>} help="Upload the required documents, complete Details & review, then submit for an independent decision. Uploading a document does not approve the customer. Private originals: PDF/JPEG/PNG, 5 MB each, up to 20 uncleaned files per case. Only authorised document viewers can download stored files; download links expire after 60 seconds. File management contains preservation and administrator removal controls. Customer correspondence and issued PDFs remain separate.">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {progress && uploadPercent === null && <p role="status" className="text-sm">{progress}</p>}
    {!view && !error && <p>Loading verification…</p>}
    {view && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">{statusLabel}</span>{view.canReadSubmissions && <span className="text-xs text-muted-foreground">Upload documents → Submit for review → Decision</span>}</div>
      {!view.policyVersion && <p>Ask a tenant administrator to publish verification requirements before collection.</p>}
      {!view.case && view.canStart && <Button type="button" disabled={busy || !view.policyVersion} loading={busy} onClick={() => void act(() => request("/api/verification/cases", { kind, id }))}>Start verification</Button>}
      {view.case && <div role="tablist" aria-label="Verification sections" className="flex gap-2 overflow-x-auto border-b pb-2 [&>button]:shrink-0">{[["evidence", "Documents", "1"], ...(view.canReadSubmissions ? [["review", "Details & review", "2"]] : []), ...(view.canReadHolds || view.canCleanup ? [["retention", "File management", ""]] : [])].map(([value, label, step]) => <Button key={value} id={`${panelId}-${value}-tab`} type="button" role="tab" aria-controls={`${panelId}-${value}`} aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} onClick={() => openTab(value)}>{step && <span aria-hidden="true" className="text-xs text-muted-foreground">{step}.</span>}{label}</Button>)}</div>}
      <div id={`${panelId}-evidence`} role="tabpanel" aria-label="Documents" hidden={tab !== "evidence"} className="space-y-4">
      {view.case && view.canUpload && <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Upload a document</h3><span className="text-xs text-muted-foreground">PDF, JPEG or PNG · Up to 5 MB each</span></div>
        {!view.documents.length ? <p>No document types are configured for this customer type.</p> : <>
          <div className="grid items-start gap-3 sm:grid-cols-2"><div className="space-y-1"><label htmlFor="verification-document" className="block text-sm font-medium">Document type</label><Select id="verification-document" value={documentCode} disabled={busy} className="w-full" onValueChange={setDocumentCode}>{view.documents.map(d => <option value={d.code} key={d.code}>{d.label}</option>)}</Select></div><div className="space-y-1"><label htmlFor="verification-file" className="block text-sm font-medium">Document file (up to 5 MB)</label><ImageFileInput key={inputKey} id="verification-file" value={file} maxBytes={view.fileLimit} accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={setFile} /></div></div>
          <Button type="button" disabled={busy || !file || !documentCode} loading={busy} onClick={() => void act(uploadFile)}>Upload document</Button>
          {uploadPercent !== null && <div className="space-y-2"><p role="status" className="text-sm">Uploading file…</p><div className="flex items-center gap-3"><div role="progressbar" aria-label="Document upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadPercent} className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${uploadPercent}%` }} /></div><span aria-hidden="true" className="text-sm tabular-nums">{uploadPercent}%</span></div></div>}
        </>}
      </div>}
      {!!view.pending.length && <div className="space-y-2"><h3 className="font-medium">Your unfinished uploads</h3>{view.pending.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span className="min-w-0 break-all text-sm">{row.filename}</span><div className="flex flex-wrap gap-2">{view.canUpload && <Button type="button" variant="outline" disabled={busy} onClick={() => void act(() => request(`/api/verification/evidence/${row.id}/finalize`, {}))}>Retry validation</Button>}{view.canCancel && <Button type="button" variant="ghost" disabled={busy} onClick={() => void act(() => request(`/api/verification/evidence/${row.id}/cancel`, {}))}>Cancel upload</Button>}</div></div>)}</div>}
      <div className="space-y-2"><h3 className="font-medium">Uploaded documents{view.canReadEvidence && view.evidence.length > 0 && <span className="ml-2 text-sm text-muted-foreground">({view.evidence.length})</span>}</h3>{!view.canReadEvidence ? <p className="text-sm text-muted-foreground">Stored documents are visible only to authorised viewers.</p> : !view.evidence.length ? <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No documents uploaded yet.</p> : view.evidence.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div className="min-w-0"><p className="break-all text-sm font-medium">{row.filename}</p><p className="text-xs text-muted-foreground">{view.documents.find(d => d.code === row.documentCode)?.label ?? row.documentCode} · {Math.ceil(row.bytes / 1024)} KB · Uploaded</p></div><Button asChild variant="outline"><a href={`/api/verification/evidence/${row.id}/download`} target="_blank" rel="noopener noreferrer">Download document</a></Button></div>)}</div>
      {view.case && view.canReadSubmissions && <div className="flex justify-end border-t pt-4"><Button type="button" variant="outline" disabled={busy} onClick={() => { openTab("review"); requestAnimationFrame(() => reviewPanel.current?.focus()) }}>Continue to details & review<ArrowRight aria-hidden="true" /></Button></div>}
      </div>
      {view.case && view.canReadSubmissions && reviewOpened && <div ref={reviewPanel} id={`${panelId}-review`} role="tabpanel" aria-label="Details & review" tabIndex={-1} hidden={tab !== "review"} className="focus:outline-none"><VerificationSubmissions kind={kind} id={id} changed={reload} onChanged={() => setReload(n => n + 1)} /></div>}
      {view.case && (view.canReadHolds || view.canCleanup) && retentionOpened && <div id={`${panelId}-retention`} role="tabpanel" aria-label="File management" hidden={tab !== "retention"} className="space-y-4">{view.canReadHolds && <VerificationRetentionControls kind={kind} id={id} changed={reload} />}{view.canCleanup && <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Advanced cleanup</summary><p className="my-3 text-sm text-muted-foreground">Remove expired, unfinished uploads across this business. Stored customer documents are retained.</p><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmCleanup(true)}>Clean expired business uploads</Button></details>}</div>}
      {confirmCleanup && view.canCleanup && <ConfirmAction title="Clean expired business uploads?" description="This checks expired, unfinished uploads across the entire business, not just this customer. Successfully stored customer documents are retained." label="Confirm cleanup" busy={busy} onCancel={() => setConfirmCleanup(false)} onConfirm={() => void act(async () => { const result = await request("/api/verification/evidence/cleanup", {}); setConfirmCleanup(false); setProgress(`Cleaned ${result.cleaned} expired, unfinished uploads across this business. Stored customer documents were retained.`) })} />}
    </>}
  </Section>
}
