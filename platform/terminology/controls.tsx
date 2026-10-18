"use client"
import * as React from "react"
import { toast } from "sonner"
import { PageHeader, FormActions, pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { FormField } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TerminologySnapshot } from "./service"

export function TerminologyControls() {
  const [data, setData] = React.useState<TerminologySnapshot | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const accept = React.useCallback((next: TerminologySnapshot) => {
    setData(next); setDraft(Object.fromEntries(next.terms.map(term => [term.key, term.override ?? ""]))); setError("")
  }, [])
  const load = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/settings/terminology", { cache: "no-store", signal })
    const next = await response.json()
    if (!response.ok) throw new Error(next.error || "Unable to load terminology.")
    accept(next)
  }, [accept])
  React.useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load])
  const changes = data?.terms.filter(term => draft[term.key] !== (term.override ?? "")) ?? []
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!data || !data.canManage || !changes.length || saving) return
    setSaving(true); setError("")
    try {
      const response = await fetch("/api/settings/terminology", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: data.version, changes: changes.map(term => ({ key: term.key, label: draft[term.key].trim() || null })) }) })
      const next = await response.json()
      if (!response.ok) throw new Error(next.error || "Unable to save terminology.")
      accept(next); window.dispatchEvent(new Event("terminology-changed")); toast.success("Terminology saved.")
    } catch (error) { setError((error as Error).message) }
    finally { setSaving(false) }
  }
  return <div className={pageClass}>
    <PageHeader title="Terminology" description="Use the terms your team knows. Leave a label blank to use its default." actions={<FormActions form="terminology-form" cancelHref="/settings" saveLabel="Save terminology" saving={saving} disabled={!changes.length || loading} canSave={data?.canManage ?? false} />} />
    {loading && <p>Loading terminology...</p>}
    {error && <div role="alert" className="space-y-2 text-destructive"><p>{error}</p><Button variant="outline" disabled={saving} onClick={() => { setLoading(true); load().catch(error => setError(error.message)).finally(() => setLoading(false)) }}>Refresh terminology</Button></div>}
    {data && !data.canManage && <p role="alert">Only a business administrator can change terminology.</p>}
    {data?.canManage && <form id="terminology-form" onSubmit={save} className="space-y-6">
      {!data.terms.length && <p>No configurable labels are available for your active modules.</p>}
      {[...new Set(data.terms.map(term => term.section))].map(section => <Section key={section} title={section}>
        <div className="grid gap-5 sm:grid-cols-2">{data.terms.filter(term => term.section === section).map(term => <FormField key={term.key} id={term.key} label={term.defaultLabel}>
          <Input id={term.key} value={draft[term.key] ?? ""} placeholder={term.defaultLabel} maxLength={60} disabled={saving || loading} onChange={event => setDraft(previous => ({ ...previous, [term.key]: event.target.value }))} />
          <div className="flex min-h-8 items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Default: {term.defaultLabel}</span>{draft[term.key] && <Button type="button" variant="link" size="sm" disabled={saving} aria-label={`Reset ${term.defaultLabel} to default`} onClick={() => setDraft(previous => ({ ...previous, [term.key]: "" }))}>Use default</Button>}</div>
        </FormField>)}</div>
      </Section>)}
    </form>}
  </div>
}
