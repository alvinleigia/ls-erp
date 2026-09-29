"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { CrmSelect } from "./crm-controls"
import { CrmPageHeader, CrmActionBar, crmPageClass } from "./crm-page"
import { CrmSection } from "./crm-section"

type Preset = { id: string; name: string; version: number }
type Review = Preset & { token: string; items: { key: string; label: string; description: string; action: string }[] }
export function ConfigurationPresets() {
  const [items, setItems] = React.useState<Preset[]>([]), [selected, setSelected] = React.useState("")
  const [review, setReview] = React.useState<Review | null>(null), [error, setError] = React.useState(""), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/crm/presets", { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load presets."); setItems(data) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [])
  async function load(apply = false) {
    setBusy(true); setError(""); setMessage("")
    try {
      const response = await fetch(`/api/crm/presets/${selected}`, { cache: "no-store", ...(apply ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: review?.token }) } : {}) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to apply preset.")
      setReview(data)
      if (apply) setMessage("Preset applied. Existing configuration was preserved.")
    } catch (error) { setError((error as Error).message); setReview(null) } finally { setBusy(false) }
  }
  return <div className={crmPageClass}><CrmPageHeader title="Configuration presets" backHref="/crm/configuration" description="Preview reusable sales settings before adding them to your business." />
    <CrmSection title="Choose a preset" description="Existing choices, fields, defaults and archived items are kept. Presets do not change teams, pipelines, permissions or existing sales records.">
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"><FormField id="preset" label="Preset"><CrmSelect id="preset" value={selected} disabled={busy} onValueChange={value => { setSelected(value); setReview(null); setMessage("") }}><option value="">Select a preset</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</CrmSelect></FormField><Button variant="outline" disabled={!selected} loading={busy} onClick={() => void load()}>Preview changes</Button></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status">{message}</p>}
    </CrmSection>
    {review && <CrmSection title={`${review.name} — version ${review.version}`} description="Only the items marked Add will be created.">
      <Table><TableHeader><TableRow><TableHead>Setting</TableHead><TableHead>Details</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{review.items.map(item => <TableRow key={item.key}><TableCell className="font-medium">{item.label}</TableCell><TableCell className="whitespace-normal">{item.description}</TableCell><TableCell>{item.action === "ADD" ? "Add" : "Keep existing"}</TableCell></TableRow>)}</TableBody></Table>
      <CrmActionBar><Button variant="outline" disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button loading={busy} disabled={!review.items.some(item => item.action === "ADD")} onClick={() => void load(true)}>Apply missing settings</Button></CrmActionBar>
    </CrmSection>}
  </div>
}
