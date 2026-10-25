"use client"
import { useCreationOfficeSnapshot } from "@/platform/companies/creation-snapshot"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { initialOpportunityStage } from "../conversion-stage"
import { withRecordView, useRecordView, AccessRecordForm, AccessSummarySection, AccessSectionEdit } from "@/platform/access/record-view"
import { CrmOpportunityPanels } from "./extension-provider"
import { SalesTeamSelect } from "@/platform/teams/controls"
import { useCustomFields } from "./custom-fields"
import { LostReasonFields } from "./lost-reason-fields"
import type { CrmViewReferences } from "../view-context"
import { useCrmExtensionEditor } from "./extension-provider"
import { useCrmOpportunityPanelsAvailable } from "./extension-provider"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import { Section } from "@/components/erp/section"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Select, Textarea } from "@/components/erp/controls"
import { useCurrentResourceAction } from "@/platform/access/view-guard"
import { useBusinessModules } from "@/platform/module-provider"
import * as React from "react"
import Link from "@/platform/access/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { optionalReference, type AssignmentContext } from "@/platform/access/reference"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { CrmOpportunityRow, CrmPipelineRow } from "@/types/crm"
import { RecordSelect } from "@/components/erp/record-select"
import { selectClass } from "./record-list"
import { OpportunityTimeline } from "./opportunity-timeline"
import { WorkList } from "./work-list"

const empty = { salesTeamId: "", title: "", pipelineId: "", stageId: "", contactId: "", accountId: "", assignedUserId: "", amount: "0", currency: "", expectedCloseOn: "", description: "", lossReason: "", lostReasonId: "", probability: 10 }
function fields(record: CrmOpportunityRow) {
  return { salesTeamId: record.salesTeamId || "", title: record.title, pipelineId: record.pipelineId, stageId: record.stageId, contactId: record.contactId, accountId: record.accountId || "", assignedUserId: record.assignedUserId, amount: record.amount, currency: record.currency, expectedCloseOn: record.expectedCloseOn.slice(0, 10), description: record.description || "", lossReason: record.lossReason || "", lostReasonId: record.lostReasonId || "", probability: record.probability }
}
export const OpportunityEditor = withRecordView(OpportunityEditorBody)
function OpportunityEditorBody({ id, enquiryId, initialReferences }: { id?: string; enquiryId?: string; initialReferences?: CrmViewReferences }) {
  const creationHeaders = useCreationOfficeSnapshot(!id)
  const { can } = useBusinessModules()
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const allowedAssignment = useCurrentResourceAction("assign")
  const extension = useCrmExtensionEditor(initialReferences)
  const loadExtension = extension.load
  const custom = useCustomFields("opportunity", id, enquiryId)
  const loadCustom = custom.load

  const { formatDate } = useDateFormatter()
  const view = useRecordView()!
  const { loadAccess } = view
  const hasDocumentPanels = useCrmOpportunityPanelsAvailable()
  const router = useRouter()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id || "", canReadDirectory = can("assignmentTargets.read"), canReadPipelines = can("pipelines.read")
  const [record, setRecord] = React.useState<CrmOpportunityRow | null>(null)
  const [pipeline, setPipeline] = React.useState<CrmPipelineRow | null>(null)
  const [contact, setContact] = React.useState<{ id: string; name: string } | null>(null)
  const [values, setValues] = React.useState(empty)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const [enquiryVersion, setEnquiryVersion] = React.useState<number | undefined>()
  const [initialAccount, setInitialAccount] = React.useState<{ id: string; name: string } | null>(null)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    async function get(url: string) { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || readTerm("crm.opportunity.singular", "Unable to load opportunity.", "Unable to load {label}.")); return data }
    void (async () => {
      try {
        const [assignees, existing, enquiry, choices, settings] = await Promise.all([optionalReference<AssignmentContext>("/api/crm/assignees", canReadDirectory, controller.signal), id ? get(`/api/crm/opportunities/${id}`) : null, !id && enquiryId ? get(`/api/crm/enquiries/${enquiryId}`) : null, !id ? get("/api/crm/pipelines?pageSize=1") : null, !id ? get("/api/settings/display") : null])
        if (existing || enquiry) { loadExtension(existing || enquiry); await loadCustom(existing || enquiry, !existing && !!enquiry) }
        setEnquiryVersion(enquiry?.version); setInitialAccount(enquiry?.account || null)
        if (existing) { setRecord(existing); loadAccess(existing.recordAccess); setContact(existing.contact); setValues(fields(existing)) }
        else if (enquiry?.opportunity) router.replace(`/crm/opportunities/${enquiry.opportunity.id}`)
        else { setContact(enquiry?.contact || null); setValues({ ...empty, salesTeamId: enquiry?.salesTeamId || "", title: enquiry?.title || "", contactId: enquiry?.contact.id || "", accountId: enquiry?.accountId || "", expectedCloseOn: enquiry?.targetCloseOn?.slice(0, 10) || "", description: enquiry?.requirements || "", assignedUserId: assignees?.canAssign ? enquiry?.assignedUserId || assignees.currentUserId : currentUserId, pipelineId: choices?.items[0]?.id || "", currency: settings?.settings?.currency || "" }) }
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setFailed(true) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [loadAccess, readTerm, id, enquiryId, router, loadExtension, loadCustom, currentUserId, canReadDirectory])
  React.useEffect(() => {
    if (!values.pipelineId || !canReadPipelines) return
    const controller = new AbortController()
    void fetch(`/api/crm/pipelines/${values.pipelineId}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data: CrmPipelineRow & { error?: string } = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load stages.")
      if (controller.signal.aborted) return
      setPipeline(data)
      setValues(previous => {
        if (previous.pipelineId !== data.id) return previous
        if (previous.stageId && data.stages.some(stage => stage.id === previous.stageId)) return previous
        const first = initialOpportunityStage(data.stages, !id && !!enquiryId)
        return { ...previous, stageId: first?.id || "", probability: first?.probability ?? 10 }
      })
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setPipeline(null) } })
    return () => controller.abort()
  }, [values.pipelineId, id, enquiryId, canReadPipelines])
  const stage = pipeline?.stages.find(stage => stage.id === values.stageId)
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const response = await fetch(id ? `/api/crm/opportunities/${id}` : "/api/crm/opportunities", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...await creationHeaders() }, body: JSON.stringify({ ...values, ...custom.payload, ...(!enquiryId ? extension.payload : {}), ...(id ? { version: record?.version } : { enquiryId: enquiryId || "", enquiryVersion }) }) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || readTerm("crm.opportunity.singular", "Unable to save opportunity.", "Unable to save {label}.")) }
      view.done(); toast.success(term("crm.opportunity.singular", "Opportunity saved.", "{label} saved."))
      if (!id) router.push(`/crm/opportunities/${data.id}`)
      else { setRecord(data); loadAccess(data.recordAccess); setContact(data.contact); setValues(fields(data)); loadExtension(data); await loadCustom(data); setRevision(value => value + 1) }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  const currencies = React.useMemo(() => Intl.supportedValuesOf("currency").map(value => ({ value, label: value })), [])
  if (loading) return <p>{term("crm.opportunity.singular", "Loading opportunity…", "Loading {label}…")}</p>
  return <div className={pageClass}>    <AccessPageHeader title={id ? record?.title || term("crm.opportunity.singular", "Opportunity") : enquiryId ? `Convert ${term("crm.enquiry.singular", "enquiry")} to ${term("crm.opportunity.singular", "opportunity")}` : term("crm.opportunity.singular", "New opportunity", "New {label}")} backHref="/crm/opportunities" backLabel={term("crm.opportunity.plural", "Back to opportunities", "Back to {label}")} actions={<AccessFormActions form="opportunity-form" cancelHref="/crm/opportunities" saving={saving} disabled={custom.blocked || failed || !stage || pipeline?.id !== values.pipelineId} canSave={true} saveLabel={term("crm.opportunity.singular", "Save opportunity", "Save {label}")} />} /><AccessRecordForm id="opportunity-form" onSubmit={save} saving={saving} disabled={custom.blocked || failed || !stage || pipeline?.id !== values.pipelineId} error={error} fingerprint={{ values, custom: custom.payload, extension: extension.payload }} initialSection="Opportunity details"
      overview={record && <>
        <AccessSummarySection sectionKey="Opportunity details" title={term("crm.opportunity.singular", "Opportunity details", "{label} details")} fields={[{ label: "Title", value: record.title }, { label: term("crm.contact.singular", "Contact"), value: record.contact.name }, { label: term("crm.account.singular", "Company"), value: record.account?.name }, { label: "Pipeline", value: record.pipeline.name }, { label: "Stage", value: record.stage.name }, { label: "Salesperson", value: record.assignee.name }, { label: "Sales team", value: record.salesTeam?.name }, { label: "Expected value", value: formatDecimalCurrency(record.amount, record.currency) }, { label: "Expected close", value: formatDate(record.expectedCloseOn) }, { label: "Probability", value: `${record.probability}%` }, { label: "Description", value: record.description }, { label: "Lost reason", value: record.lostReasonName }, { label: "Closing note", value: record.lossReason }]} />
        {record.enquiryId && <AccessSummarySection title="Lead attribution" canEdit={false} fields={[{ label: "Original source", value: record.source }, { label: "Referrer", value: record.referralRestricted ? "Restricted" : record.referralContact?.name || record.referralAccount?.name }]}><Link className="text-sm underline" href={`/crm/enquiries/${record.enquiryId}`}>{term("crm.enquiry.singular", "Original enquiry", "Original {label}")}</Link></AccessSummarySection>}
        {extension.summary()} {custom.readOnlySection(<AccessSectionEdit section="Additional information" />)}
      </>}
      tabs={record ? [
        ...(hasDocumentPanels ? [{ value: "documents", permission: "quotations.read" as const, label: "Sales documents", content: <CrmOpportunityPanels opportunityId={record.id} /> }] : []),
        { value: "activities", permission: "activities.read" as const, label: term("crm.activity.plural", "Activities"), content: <WorkList contactId={record.contactId} opportunityId={record.id} /> },
        { value: "history", label: "History", content: <OpportunityTimeline id={record.id} revision={revision} /> },
      ] : []}>


    <Section sectionKey="Opportunity details" title={term("crm.opportunity.singular", "Opportunity details", "{label} details")} description="Customer, pipeline stage and expected value."><fieldset disabled={failed || saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
      <FormField id="title" label={term("crm.opportunity.singular", "Opportunity title", "{label} title")} error={errors.title} className="sm:col-span-2"><Input id="title" required maxLength={200} value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} /></FormField>
      <FormField id="pipelineId" label="Pipeline" error={errors.pipelineId}><RecordSelect id="pipelineId" endpoint="/api/crm/pipelines" value={values.pipelineId} selected={pipeline?.id === values.pipelineId ? { value: pipeline.id, label: pipeline.name } : undefined} onChange={pipelineId => setValues(previous => previous.pipelineId === pipelineId ? previous : { ...previous, pipelineId, stageId: "" })} /><Link className="text-sm underline" href="/crm/pipelines">Manage pipelines</Link></FormField>
      <FormField id="stageId" label="Stage" error={errors.stageId}><Select id="stageId" required className={`${selectClass} w-full`} value={values.stageId} onValueChange={event => { const stage = pipeline?.stages.find(stage => stage.id === event); if (stage) setValues({ ...values, stageId: stage.id, probability: stage.probability, lossReason: stage.kind === "LOST" ? values.lossReason : "", lostReasonId: stage.kind === "LOST" ? values.lostReasonId : "" }) }}><option value="">Select a stage</option>{pipeline?.id === values.pipelineId && pipeline.stages.filter(stage => !stage.archived || stage.id === values.stageId).map(stage => <option key={stage.id} value={stage.id} disabled={stage.archived}>{stage.name}{stage.archived ? " (archived)" : ""}</option>)}</Select></FormField>
      <FormField id="contactId" label={term("crm.contact.singular", "Contact")} error={errors.contactId}><RecordSelect id="contactId" endpoint="/api/crm/contacts" value={values.contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={contactId => setValues({ ...values, contactId })} disabled={!!enquiryId || !!record?.enquiryId} /></FormField>
      <FormField id="accountId" label={term("crm.account.singular", "Business account (optional)", "{label} (optional)")} error={errors.accountId}><RecordSelect id="accountId" endpoint="/api/crm/accounts" value={values.accountId} selected={(record?.account || initialAccount) ? { value: (record?.account || initialAccount)!.id, label: (record?.account || initialAccount)!.name } : undefined} onChange={accountId => setValues({ ...values, accountId })} />{values.accountId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, accountId: "" })}>{term("crm.account.singular", "Clear account", "Clear {label}")}</Button>}</FormField>
      <SalesTeamSelect value={values.salesTeamId} selected={record?.salesTeam} disabled={(!!id && !allowedAssignment) || !!enquiryId} onChange={salesTeamId => { setValues({ ...values, salesTeamId }); void custom.changeTeam(salesTeamId) }} />
      <FormField id="assignedUserId" label="Salesperson" error={errors.assignedUserId}><RecordSelect id="assignedUserId" endpoint={values.salesTeamId ? `/api/crm/assignees?salesTeamId=${values.salesTeamId}` : "/api/crm/assignees"} value={values.assignedUserId} selected={{ value: record?.assignee.id || values.assignedUserId, label: record?.assignee.name || session?.user?.name || "Salesperson" }} onChange={assignedUserId => setValues({ ...values, assignedUserId })} disabled={!allowedAssignment || !canReadDirectory} /></FormField>
      <FormField id="expectedCloseOn" label="Expected close date" error={errors.expectedCloseOn}><Input id="expectedCloseOn" required type="date" value={values.expectedCloseOn} onChange={event => setValues({ ...values, expectedCloseOn: event.target.value })} /></FormField>
      <FormField id="amount" label="Expected value" error={errors.amount}><Input id="amount" inputMode="decimal" required value={values.amount} onChange={event => setValues({ ...values, amount: event.target.value })} /></FormField>
      <FormField id="currency" label="Currency" error={errors.currency}><SearchableSelect id="currency" options={currencies} value={values.currency} onChange={currency => setValues({ ...values, currency })} placeholder="Choose currency" /></FormField>
      <FormField id="probability" label="Probability %" error={errors.probability}><Input id="probability" type="number" min={0} max={stage?.kind === "OPEN" ? 99 : 100} required disabled={stage?.kind !== "OPEN"} value={values.probability} onChange={event => setValues({ ...values, probability: Number(event.target.value) })} /></FormField>
      {stage?.kind === "LOST" && <LostReasonFields value={values.lostReasonId} name={record?.lostReasonName} note={values.lossReason} legacy={record?.stage.kind === "LOST" && !record.lostReasonId} onReasonChange={lostReasonId => setValues({ ...values, lostReasonId })} onNoteChange={lossReason => setValues({ ...values, lossReason })} />}
      <FormField id="description" label="Description" error={errors.description} className="sm:col-span-2"><Textarea id="description" maxLength={5000} value={values.description} onChange={event => setValues({ ...values, description: event.target.value })} /></FormField>
    </fieldset></Section>
    {record?.enquiryId && <Section title="Lead attribution"><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Original source</dt><dd>{record.source || "Not recorded"}</dd></div><div><dt className="text-muted-foreground">Referrer</dt><dd>{record.referralRestricted ? "Restricted" : record.referralContact?.name || record.referralAccount?.name || "Not recorded"}</dd></div></dl></Section>}
    {(record?.enquiryId || enquiryId) && <p className="text-sm">Source: <Link className="underline" href={`/crm/enquiries/${record?.enquiryId || enquiryId}`}>{term("crm.enquiry.singular", "original enquiry and follow-ups", "original {label} and follow-ups")}</Link>. Its records and history are preserved.</p>}
    {extension.fields({ errors, disabled: saving || failed, readOnly: !!enquiryId && !id })}
    {custom.section(saving || failed)}
  </AccessRecordForm></div>
}
