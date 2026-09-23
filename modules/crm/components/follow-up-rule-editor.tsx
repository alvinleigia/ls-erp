"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { useFormErrors } from "@/hooks/use-form-errors"
import { selectClass } from "./record-list"
import { ActivityStepFields } from "./activity-step-fields"
import { workTypes, workOutcomes } from "../work-validation"
import type { FollowUpRuleRow } from "@/types/crm-follow-ups"
import type { PlanStep } from "../plan-validation"

export function FollowUpRuleEditor({ id }: { id?: string }) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [sourceType, setSourceType] = React.useState<FollowUpRuleRow["sourceType"]>("CALL"), [outcome, setOutcome] = React.useState("NO_ANSWER")
  const [nextStep, setNextStep] = React.useState<PlanStep>({ title: "Retry call", type: "CALL", callDirection: "OUTBOUND", dayOffset: 1, description: "", priority: 2, reminderTime: null })
  const [maxDepth, setMaxDepth] = React.useState(3), [archived, setArchived] = React.useState(false)
  const [record, setRecord] = React.useState<FollowUpRuleRow | null>(null), [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(id ? `/api/crm/follow-up-rules/${id}` : "/api/crm/follow-up-rules?pageSize=1", { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load rule."); setCanManage(data.canManage); if (id) { setRecord(data); setName(data.name); setSourceType(data.sourceType); setOutcome(data.outcome); setNextStep(data.nextStep); setMaxDepth(data.maxDepth); setArchived(data.archived) } }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, revision])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const response = await fetch(id ? `/api/crm/follow-up-rules/${id}` : "/api/crm/follow-up-rules", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, sourceType, outcome, nextStep, maxDepth, ...(id ? { version: record?.version, archived } : {}) }) })
      const data = await response.json(); if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save rule.") }
      toast.success("Follow-up rule saved."); if (id) setRecord(data); else router.push(`/crm/follow-up-rules/${data.id}`)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading rule…</p>
  return <section className="mx-auto max-w-4xl space-y-5"><div className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-semibold">{id ? "Follow-up rule" : "New follow-up rule"}</h1><div className="flex gap-2">{id && <Button variant="outline" disabled={saving} onClick={() => { setRevision(value => value + 1); setError(""); clearErrors() }}>Reload saved rule</Button>}<Button variant="outline" asChild><Link href="/crm/follow-up-rules">All rules</Link></Button></div></div>
    <p className="text-sm text-muted-foreground">A rule suggests one next activity when staff complete standalone work with the selected outcome. Staff review the suggestion or record a reason to skip it. Activity-plan steps and logging past interactions do not trigger rules.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <form onSubmit={save} className="space-y-5"><fieldset disabled={!canManage || saving} className="space-y-5"><FormField id="rule-name" label="Rule name" error={errors.name}><Input id="rule-name" required maxLength={150} value={name} onChange={event => setName(event.target.value)} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2"><FormField id="rule-type" label="When completing" error={errors.sourceType}><select id="rule-type" className={`${selectClass} w-full`} value={sourceType} onChange={event => { const type = event.target.value as FollowUpRuleRow["sourceType"]; setSourceType(type); setOutcome(workOutcomes[type][0]) }}>{workTypes.map(type => <option key={type}>{type}</option>)}</select></FormField><FormField id="rule-outcome" label="With outcome" error={errors.outcome}><select id="rule-outcome" className={`${selectClass} w-full`} value={outcome} onChange={event => setOutcome(event.target.value)}>{workOutcomes[sourceType].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></FormField></div>
      <FormField id="rule-depth" label="Maximum consecutive generated follow-ups" error={errors.maxDepth}><Input id="rule-depth" type="number" required min={1} max={10} value={maxDepth} onChange={event => setMaxDepth(Number(event.target.value))} /><p className="text-xs text-muted-foreground">Counts across rules in the same generated chain. The limit prevents indefinite retries.</p></FormField>
      {id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Archived (stop suggesting this rule)</label>}
      <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-2 font-medium">Suggested next activity</legend><p className="text-sm text-muted-foreground">Same customer, related record and staff assignee. Calendar days include weekends; reminders use the business time zone. Editing this rule affects future completions, not activities already created.</p>{errors.nextStep && <p role="alert" className="text-sm text-destructive">{errors.nextStep}</p>}<ActivityStepFields prefix="rule-next" step={nextStep} onChange={patch => setNextStep(previous => ({ ...previous, ...patch }))} offsetLabel="Days after completion" /></fieldset>
    </fieldset>{canManage && <Button type="submit" loading={saving}>Save rule</Button>}</form>
  </section>
}
