"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { ConfirmAction } from "@/components/erp/confirm-action"

export function QuotationPdfActions({ id, revision, issued, canIssue, disabled, onIssued }: {
  id: string; revision: number; issued: boolean; canIssue: boolean; disabled: boolean; onIssued: () => Promise<void>
}) {
  const [confirm, setConfirm] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("")
  const url = `/api/crm/quotations/${id}/pdf?revision=${revision}`
  async function issue() {
    setBusy(true); setError("")
    try {
      const response = await fetch(`/api/crm/quotations/${id}/issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to issue this document.")
      await onIssued(); setConfirm(false)
      const link = document.createElement("a"); link.href = url; link.click()
    } catch (error) { setError((error as Error).message); setConfirm(false) }
    finally { setBusy(false) }
  }
  return <>
    <Button asChild variant="outline"><a href={url} target="_blank" rel="noreferrer">{issued ? "Download issued PDF" : "Preview saved draft"}</a></Button>
    {!issued && canIssue && <Button type="button" disabled={disabled || busy} loading={busy} loadingText="Issuing..." onClick={() => setConfirm(true)}>Issue &amp; Download</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {confirm && <ConfirmAction title={`Issue version ${revision}?`} description="This saves the exact PDF for this version. Later downloads reuse it. Changes must be saved as a new version." label="Issue & Download" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void issue()} />}
  </>
}
