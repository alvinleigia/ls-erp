"use client"
import { useTerminology } from "@/platform/terminology/provider"
import { withRecordView, useRecordView, AccessRecordForm, AccessSummarySection } from "@/platform/access/record-view"
import { Section } from "@/components/erp/section"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Textarea, Checkbox } from "@/components/erp/controls"
import * as React from "react"
import Link from "@/platform/access/link"
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
export const ActivityPlanEditor = withRecordView(ActivityPlanEditorBody)
function ActivityPlanEditorBody({ id }: { id?: string }) {
  const term = useTerminology()
  const view = useRecordView()!
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
      view.done(); toast.success(term("crm.activity.singular", "Activity plan saved.", "{label} plan saved.")); if (!id) router.push(`/crm/activity-plans/${data.id}`); else setRecord(data)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading plan…</p>
  return <section className={pageClass}><AccessPageHeader title={id ? name || term("crm.activity.singular", "Activity plan", "{label} plan") : term("crm.activity.singular", "New activity plan", "New {label} plan")} backHref="/crm/activity-plans" actions={<AccessFormActions form="plan-form" cancelHref="/crm/activity-plans" canSave={canManage} saving={saving} saveLabel="Save plan">{id && record && !record.archived && <Button type="button" variant="outline" asChild><Link href={`/crm/activity-plans/apply?planId=${id}`}>Apply saved plan</Link></Button>}</AccessFormActions>} /><p className="text-sm text-muted-foreground">{term("crm.activity.plural", "Steps use calendar days after the start date, including weekends. All steps are created immediately as all-day activities. Reminders use the business time zone. Editing or archiving this template does not change existing activities.", "Steps use calendar days after the start date, including weekends. All steps are created immediately as all-day {label}. Reminders use the business time zone. Editing or archiving this template does not change existing {label}.")}</p>
    <AccessRecordForm id="plan-form" onSubmit={save} saving={saving} disabled={!canManage} error={error} fingerprint={{ name, description, steps, archived }} initialSection="Plan details"
      overview={record && <>
        <AccessSummarySection title="Plan details" canEdit={canManage} fields={[{ label: "Plan name", value: record.name }, { label: "Purpose", value: record.description }, { label: "Status", value: record.archived ? "Archived" : "Active" }, { label: "Steps", value: record.steps.length }]} />

      </>} tabs={record ? [{ value: "steps", label: "Plan steps", content: <>{record.steps.map((step, index) => <AccessSummarySection key={index} title={`Step ${index + 1}`} canEdit={canManage} fields={[{ label: term("crm.activity.singular", "Activity"), value: step.title }, { label: "Type", value: step.type }, { label: "Days after start", value: step.dayOffset }, { label: "Instructions", value: step.description }, { label: "Reminder time", value: step.reminderTime }]} />)}</> }] : []}><fieldset disabled={!canManage || saving} className="space-y-5">
      <Section title="Plan details"><FormField id="plan-name" label="Plan name" error={errors.name}><Input id="plan-name" required maxLength={150} value={name} onChange={event => setName(event.target.value)} /></FormField>
      <FormField id="plan-description" label="Purpose" error={errors.description}><Textarea id="plan-description" maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></FormField>
      {errors.steps && <p role="alert" className="text-sm text-destructive">Steps: {errors.steps}</p>}
      {id && <label className="flex items-center gap-2 text-sm"><Checkbox  checked={archived} onChange={event => setArchived(event.target.checked)} />Archived (prevent new applications)</label>}
      </Section>{steps.map((step, index) => <Section key={index} title={`Step ${index + 1}`}><ActivityStepFields prefix={`step-${index}`} step={step} minOffset={index ? steps[index - 1].dayOffset : 0} onChange={patch => change(index, patch)} />{canManage && <Button type="button" variant="outline" size="sm" disabled={steps.length <= 1} onClick={() => setSteps(previous => previous.filter((_, i) => i !== index))}>Remove step</Button>}</Section>)}
      {canManage && <Button type="button" variant="outline" disabled={steps.length >= 12} onClick={() => setSteps(previous => [...previous, newStep(Math.min(365, previous[previous.length - 1].dayOffset + 1))])}>Add step (up to 12)</Button>}
    </fieldset></AccessRecordForm>
  </section>
}
