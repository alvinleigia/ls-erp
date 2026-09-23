"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { useFormErrors } from "@/hooks/use-form-errors"
import { ActivityStepFields } from "./activity-step-fields"
import type { PlanStep } from "../plan-validation"
import type { ActivityPlanRow } from "@/types/crm-plans"
const newStep = (dayOffset = 0): PlanStep => ({ title: "", type: "CALL", callDirection: "OUTBOUND", dayOffset, priority: 2, description: "", reminderTime: null })
export function ActivityPlanEditor({ id }: { id?: string }) {
  const router = useRouter()
  const [name, setName] = React.useState(""), [description, setDescription] = React.useState("")
  const [steps, setSteps] = React.useState<PlanStep[]>([newStep()]), [record, setRecord] = React.useState<ActivityPlanRow | null>(null)
  const [archived, setArchived] = React.useState(false), [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [error, setError] = React.useState("")
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(id ? `/api/crm/activity-plans/${id}` : "/api/crm/activity-plans?pageSize=1", { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load plan."); setCanManage(data.canManage); if (id) { setRecord(data); setName(data.name); setDescription(data.description || ""); setSteps(data.steps); setArchived(data.archived) } }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  const change = (index: number, patch: Partial<PlanStep>) => setSteps(previous => previous.map((step, i) => i === index ? { ...step, ...patch } : step))
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const response = await fetch(id ? `/api/crm/activity-plans/${id}` : "/api/crm/activity-plans", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, steps, ...(id ? { archived, version: record?.version } : {}) }) })
      const data = await response.json(); if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save plan.") }
      toast.success("Activity plan saved."); if (!id) router.push(`/crm/activity-plans/${data.id}`); else setRecord(data)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading plan…</p>
  return <section className="mx-auto max-w-4xl space-y-5"><div className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-semibold">{id ? name || "Activity plan" : "New activity plan"}</h1><Button variant="outline" asChild><Link href="/crm/activity-plans">All plans</Link></Button></div><p className="text-sm text-muted-foreground">Steps use calendar days after the start date, including weekends. All steps are created immediately as all-day activities. Reminders use the business time zone. Editing or archiving this template does not change existing activities.</p>{error && <p role="alert" className="text-destructive">{error}</p>}
    <form onSubmit={save} className="space-y-5"><fieldset disabled={!canManage || saving} className="space-y-5">
      <FormField id="plan-name" label="Plan name" error={errors.name}><Input id="plan-name" required maxLength={150} value={name} onChange={event => setName(event.target.value)} /></FormField>
      <FormField id="plan-description" label="Purpose" error={errors.description}><textarea id="plan-description" maxLength={2000} className="min-h-20 w-full rounded border p-3" value={description} onChange={event => setDescription(event.target.value)} /></FormField>
      {errors.steps && <p role="alert" className="text-sm text-destructive">Steps: {errors.steps}</p>}
      {id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Archived (prevent new applications)</label>}
      {steps.map((step, index) => <fieldset key={index} className="space-y-3 rounded-xl border p-4"><legend className="px-2 font-medium">Step {index + 1}</legend><ActivityStepFields prefix={`step-${index}`} step={step} minOffset={index ? steps[index - 1].dayOffset : 0} onChange={patch => change(index, patch)} />{canManage && <Button type="button" variant="outline" size="sm" disabled={steps.length <= 1} onClick={() => setSteps(previous => previous.filter((_, i) => i !== index))}>Remove step</Button>}</fieldset>)}
      {canManage && <Button type="button" variant="outline" disabled={steps.length >= 12} onClick={() => setSteps(previous => [...previous, newStep(Math.min(365, previous[previous.length - 1].dayOffset + 1))])}>Add step (up to 12)</Button>}
    </fieldset><div className="flex gap-3">{canManage && <Button type="submit" loading={saving}>Save plan</Button>}{id && record && !record.archived && <Button type="button" variant="outline" asChild><Link href={`/crm/activity-plans/apply?planId=${id}`}>Apply saved plan</Link></Button>}</div></form>
  </section>
}
