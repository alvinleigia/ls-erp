"use client"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmFormActions, crmPageClass } from "./crm-page"
import { CrmSelect, CrmTextarea } from "./crm-controls"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { CrmOpportunityRow, CrmPipelineRow } from "@/types/crm"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { OpportunityTimeline } from "./opportunity-timeline"
import { WorkList } from "./work-list"

const empty = { title: "", pipelineId: "", stageId: "", contactId: "", accountId: "", assignedUserId: "", amount: "0", currency: "", expectedCloseOn: "", description: "", lossReason: "", probability: 10 }
function fields(record: CrmOpportunityRow) {
  return { title: record.title, pipelineId: record.pipelineId, stageId: record.stageId, contactId: record.contactId, accountId: record.accountId || "", assignedUserId: record.assignedUserId, amount: record.amount, currency: record.currency, expectedCloseOn: record.expectedCloseOn.slice(0, 10), description: record.description || "", lossReason: record.lossReason || "", probability: record.probability }
}
export function OpportunityEditor({ id, enquiryId }: { id?: string; enquiryId?: string }) {
  const router = useRouter()
  const { data: session } = useSession()
  const [record, setRecord] = React.useState<CrmOpportunityRow | null>(null)
  const [pipeline, setPipeline] = React.useState<CrmPipelineRow | null>(null)
  const [contact, setContact] = React.useState<{ id: string; name: string } | null>(null)
  const [values, setValues] = React.useState(empty)
  const [canAssign, setCanAssign] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    async function get(url: string) { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load opportunity."); return data }
    void (async () => {
      try {
        const [assignees, existing, enquiry, choices, settings] = await Promise.all([get("/api/crm/assignees"), id ? get(`/api/crm/opportunities/${id}`) : null, !id && enquiryId ? get(`/api/crm/enquiries/${enquiryId}`) : null, !id ? get("/api/crm/pipelines?pageSize=1") : null, !id ? get("/api/settings/display") : null])
        setCanAssign(assignees.canAssign)
        if (existing) { setRecord(existing); setContact(existing.contact); setValues(fields(existing)) }
        else if (enquiry?.opportunity) router.replace(`/crm/opportunities/${enquiry.opportunity.id}`)
        else { setContact(enquiry?.contact || null); setValues({ ...empty, title: enquiry?.title || "", contactId: enquiry?.contact.id || "", description: enquiry?.requirements || "", assignedUserId: assignees.canAssign ? enquiry?.assignedUserId || assignees.currentUserId : assignees.currentUserId, pipelineId: choices?.items[0]?.id || "", currency: settings?.settings?.currency || "" }) }
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setFailed(true) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [id, enquiryId, router])
  React.useEffect(() => {
    if (!values.pipelineId) return
    const controller = new AbortController()
    void fetch(`/api/crm/pipelines/${values.pipelineId}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data: CrmPipelineRow & { error?: string } = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load stages.")
      setPipeline(data)
      setValues(previous => {
        if (previous.stageId && data.stages.some(stage => stage.id === previous.stageId)) return previous
        const first = data.stages.find(stage => !stage.archived && stage.kind === "OPEN")
        return { ...previous, stageId: first?.id || "", probability: first?.probability ?? 10 }
      })
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setPipeline(null) } })
    return () => controller.abort()
  }, [values.pipelineId])
  const stage = pipeline?.stages.find(stage => stage.id === values.stageId)
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const response = await fetch(id ? `/api/crm/opportunities/${id}` : "/api/crm/opportunities", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, ...(id ? { version: record?.version } : { enquiryId: enquiryId || "" }) }) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save opportunity.") }
      toast.success("Opportunity saved.")
      if (!id) router.push(`/crm/opportunities/${data.id}`)
      else { setRecord(data); setContact(data.contact); setValues(fields(data)); setRevision(value => value + 1) }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  const currencies = React.useMemo(() => Intl.supportedValuesOf("currency").map(value => ({ value, label: value })), [])
  if (loading) return <p>Loading opportunity…</p>
  return <div className={crmPageClass}><form id="opportunity-form" onSubmit={save} className="space-y-5">
    <CrmPageHeader title={id ? record?.title || "Opportunity" : enquiryId ? "Convert enquiry to opportunity" : "New opportunity"} backHref="/crm/opportunities" backLabel="Back to opportunities" actions={<CrmFormActions form="opportunity-form" cancelHref="/crm/opportunities" saving={saving} disabled={failed || !stage || pipeline?.id !== values.pipelineId} canSave={true} saveLabel="Save opportunity" />} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <CrmSection title="Opportunity details" description="Customer, pipeline stage and expected value."><fieldset disabled={failed || saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
      <FormField id="title" label="Opportunity title" error={errors.title} className="sm:col-span-2"><Input id="title" required maxLength={200} value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} /></FormField>
      <FormField id="pipelineId" label="Pipeline" error={errors.pipelineId}><RecordSelect id="pipelineId" endpoint="/api/crm/pipelines" value={values.pipelineId} selected={pipeline?.id === values.pipelineId ? { value: pipeline.id, label: pipeline.name } : undefined} onChange={pipelineId => setValues({ ...values, pipelineId, stageId: "" })} /><Link className="text-sm underline" href="/crm/pipelines">Manage pipelines</Link></FormField>
      <FormField id="stageId" label="Stage" error={errors.stageId}><CrmSelect id="stageId" required className={`${selectClass} w-full`} value={values.stageId} onValueChange={event => { const stage = pipeline?.stages.find(stage => stage.id === event); if (stage) setValues({ ...values, stageId: stage.id, probability: stage.probability, lossReason: stage.kind === "LOST" ? values.lossReason : "" }) }}><option value="">Select a stage</option>{pipeline?.id === values.pipelineId && pipeline.stages.filter(stage => !stage.archived || stage.id === values.stageId).map(stage => <option key={stage.id} value={stage.id} disabled={stage.archived}>{stage.name}{stage.archived ? " (archived)" : ""}</option>)}</CrmSelect></FormField>
      <FormField id="contactId" label="Contact" error={errors.contactId}><RecordSelect id="contactId" endpoint="/api/crm/contacts" value={values.contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={contactId => setValues({ ...values, contactId })} disabled={!!enquiryId || !!record?.enquiryId} /></FormField>
      <FormField id="accountId" label="Business account (optional)" error={errors.accountId}><RecordSelect id="accountId" endpoint="/api/crm/accounts" value={values.accountId} selected={record?.account ? { value: record.account.id, label: record.account.name } : undefined} onChange={accountId => setValues({ ...values, accountId })} />{values.accountId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, accountId: "" })}>Clear account</Button>}</FormField>
      <FormField id="assignedUserId" label="Salesperson" error={errors.assignedUserId}><RecordSelect id="assignedUserId" endpoint="/api/crm/assignees" value={values.assignedUserId} selected={{ value: record?.assignee.id || values.assignedUserId, label: record?.assignee.name || session?.user?.name || "Salesperson" }} onChange={assignedUserId => setValues({ ...values, assignedUserId })} disabled={!canAssign} /></FormField>
      <FormField id="expectedCloseOn" label="Expected close date" error={errors.expectedCloseOn}><Input id="expectedCloseOn" required type="date" value={values.expectedCloseOn} onChange={event => setValues({ ...values, expectedCloseOn: event.target.value })} /></FormField>
      <FormField id="amount" label="Expected value" error={errors.amount}><Input id="amount" inputMode="decimal" required value={values.amount} onChange={event => setValues({ ...values, amount: event.target.value })} /></FormField>
      <FormField id="currency" label="Currency" error={errors.currency}><SearchableSelect id="currency" options={currencies} value={values.currency} onChange={currency => setValues({ ...values, currency })} placeholder="Choose currency" /></FormField>
      <FormField id="probability" label="Probability %" error={errors.probability}><Input id="probability" type="number" min={0} max={stage?.kind === "OPEN" ? 99 : 100} required disabled={stage?.kind !== "OPEN"} value={values.probability} onChange={event => setValues({ ...values, probability: Number(event.target.value) })} /></FormField>
      {stage?.kind === "LOST" && <FormField id="lossReason" label="Loss reason" error={errors.lossReason}><CrmTextarea id="lossReason" required maxLength={2000} value={values.lossReason} onChange={event => setValues({ ...values, lossReason: event.target.value })} /></FormField>}
      <FormField id="description" label="Description" error={errors.description} className="sm:col-span-2"><CrmTextarea id="description" maxLength={5000} value={values.description} onChange={event => setValues({ ...values, description: event.target.value })} /></FormField>
    </fieldset></CrmSection>
    {(record?.enquiryId || enquiryId) && <p className="text-sm">Source: <Link className="underline" href={`/crm/enquiries/${record?.enquiryId || enquiryId}`}>original enquiry and follow-ups</Link>. Its records and history are preserved.</p>}
  </form>{record && <><WorkList contactId={record.contactId} opportunityId={record.id} /><OpportunityTimeline id={record.id} revision={revision} /></>}</div>
}
