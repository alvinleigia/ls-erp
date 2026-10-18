"use client"
import { useTerminology } from "@/platform/terminology/provider"
import { withRecordView, useRecordView, AccessRecordForm, AccessSummarySection } from "@/platform/access/record-view"
import { Section } from "@/components/erp/section"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Select, Checkbox } from "@/components/erp/controls"
import * as React from "react"
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

export const FollowUpRuleEditor = withRecordView(FollowUpRuleEditorBody)
function FollowUpRuleEditorBody({ id }: { id?: string }) {
  const term = useTerminology()
  const view = useRecordView()!
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
      view.done(); toast.success("Follow-up rule saved."); if (id) setRecord(data); else router.push(`/crm/follow-up-rules/${data.id}`)
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading rule…</p>
  return <section className={pageClass}><AccessPageHeader title={id ? name || "Follow-up rule" : "New follow-up rule"} backHref="/crm/follow-up-rules" actions={<AccessFormActions form="rule-form" cancelHref="/crm/follow-up-rules" canSave={canManage} saving={saving} saveLabel="Save rule">{id && <Button type="button" variant="outline" disabled={saving} onClick={() => { setRevision(value => value + 1); setError(""); clearErrors() }}>Reload saved rule</Button>}</AccessFormActions>} />
    <p className="text-sm text-muted-foreground">{term("crm.activity.singular", "A rule suggests one next activity when staff complete standalone work with the selected outcome. Staff review the suggestion or record a reason to skip it. Activity-plan steps and logging past interactions do not trigger rules.", "A rule suggests one next {label} when staff complete standalone work with the selected outcome. Staff review the suggestion or record a reason to skip it. Steps from a {label} plan and logging past interactions do not trigger rules.")}</p>

    <AccessRecordForm id="rule-form" onSubmit={save} saving={saving} disabled={!canManage} error={error} fingerprint={{ name, sourceType, outcome, nextStep, maxDepth, archived }} initialSection="Rule trigger"
      overview={record && <>
        <AccessSummarySection title="Rule trigger" canEdit={canManage} fields={[{ label: "Name", value: record.name }, { label: "When completing", value: record.sourceType }, { label: "Outcome", value: record.outcome.replaceAll("_", " ") }, { label: "Maximum generated follow-ups", value: record.maxDepth }, { label: "Status", value: record.archived ? "Archived" : "Active" }]} />
        <AccessSummarySection sectionKey="Suggested next activity" title={term("crm.activity.singular", "Suggested next activity", "Suggested next {label}")} canEdit={canManage} fields={[{ label: "Title", value: record.nextStep.title }, { label: "Type", value: record.nextStep.type }, { label: "Days after completion", value: record.nextStep.dayOffset }, { label: "Instructions", value: record.nextStep.description }, { label: "Reminder time", value: record.nextStep.reminderTime }]} />
      </>}><fieldset disabled={!canManage || saving} className="space-y-5"><Section title="Rule trigger"><FormField id="rule-name" label="Rule name" error={errors.name}><Input id="rule-name" required maxLength={150} value={name} onChange={event => setName(event.target.value)} /></FormField>
      <div className="grid gap-4 sm:grid-cols-2"><FormField id="rule-type" label="When completing (base behaviour)" error={errors.sourceType}><Select id="rule-type" className={`${selectClass} w-full`} value={sourceType} onValueChange={event => { const type = event as FollowUpRuleRow["sourceType"]; setSourceType(type); setOutcome(workOutcomes[type][0]) }}>{workTypes.map(type => <option key={type}>{type}</option>)}</Select></FormField><FormField id="rule-outcome" label="With outcome" error={errors.outcome}><Select id="rule-outcome" className={`${selectClass} w-full`} value={outcome} onValueChange={event => setOutcome(event)}>{workOutcomes[sourceType].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</Select></FormField></div>
      <FormField id="rule-depth" label="Maximum consecutive generated follow-ups" error={errors.maxDepth}><Input id="rule-depth" type="number" required min={1} max={10} value={maxDepth} onChange={event => setMaxDepth(Number(event.target.value))} /><p className="text-xs text-muted-foreground">Counts across rules in the same generated chain. The limit prevents indefinite retries.</p></FormField>
      {id && <label className="flex items-center gap-2 text-sm"><Checkbox  checked={archived} onChange={event => setArchived(event.target.checked)} />Archived (stop suggesting this rule)</label>}
      </Section><Section sectionKey="Suggested next activity" title={term("crm.activity.singular", "Suggested next activity", "Suggested next {label}")}><p className="text-sm text-muted-foreground">{`Same ${term("crm.contact.singular", "customer")}, related record and staff assignee. Calendar days include weekends; reminders use the business time zone. Editing this rule affects future completions, not ${term("crm.activity.plural", "activities")} already created.`}</p>{errors.nextStep && <p role="alert" className="text-sm text-destructive">{errors.nextStep}</p>}<ActivityStepFields prefix="rule-next" step={nextStep} onChange={patch => setNextStep(previous => ({ ...previous, ...patch }))} offsetLabel="Days after completion" /></Section>
    </fieldset></AccessRecordForm>
  </section>
}
