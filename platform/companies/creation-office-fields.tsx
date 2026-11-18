"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { InfoHelp } from "@/components/erp/info-help"
import { RecordOfficeFields } from "./record-office-fields"
import { OfficePreferenceEditor } from "./workspace-office-selector"
import type { useCreationOfficeContext } from "./creation-snapshot"

export function CreationOfficeFields({ capture, disabled }: { capture: ReturnType<typeof useCreationOfficeContext>; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false), [denied, setDenied] = React.useState(false)
  const forbidden = React.useCallback(() => setDenied(true), [])
  const office = capture.context?.creationOffice
  return <div className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="inline-flex items-center gap-2 font-medium">Company and office<InfoHelp title="Company and office">New independent records use this captured company and office. Choosing another updates your creation preference and this form. Other open forms keep their original context. Saved records and reports are not moved.</InfoHelp></span>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { setDenied(false); setOpen(true) }}>Choose company and office</Button></div>
    {capture.loading ? <p role="status">Loading company and office…</p> : office ? <RecordOfficeFields office={{ ...office, active: true }} /> : <p role="alert" className="text-sm text-destructive">{capture.error || "Choose an eligible company and office before saving."}</p>}
    {open && <OfficePreferenceEditor denied={denied} onForbidden={forbidden} onRetry={() => setDenied(false)} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); capture.reload(); window.dispatchEvent(new Event("workspace-office-changed")) }} />}
  </div>
}
