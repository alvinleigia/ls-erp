"use client"
import { withCrmRecordView, useCrmRecordView, CrmRecordForm, CrmSummarySection } from "./crm-record-view"
import { formatDateForDisplay } from "@/lib/date"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmFormActions, CrmActionBar, crmPageClass } from "./crm-page"
import { CrmSelect, CrmTextarea, CrmCheckbox } from "./crm-controls"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { WorkScheduleFields, emptyWork, workForm, workPayload, type WorkFormValues } from "./work-schedule-fields"
import { ContactInteractions } from "./contact-interactions"
import { WorkHistory } from "./work-history"
import { FollowUpReview, useFollowUpReview } from "./follow-up-review"
import { workOutcomes } from "../work-validation"
import { wallTime, wallTimeToInstant } from "../work-time"
import { defaultWorkHistoryFormat } from "../work-history-format"
import type { CrmWorkRow, WorkType } from "@/types/crm-work"

type Initial = { contactId?: string; enquiryId?: string; opportunityId?: string; log?: string; dueOn?: string; startsAt?: string; endsAt?: string }
type Completion = { summary: string; outcome: string; when: string; duration: string }
const emptyCompletion: Completion = { summary: "", outcome: "", when: "", duration: "" }
function CompletionFields({ type, value, onChange, timeZone }: { type: WorkType; value: Completion; onChange: (value: Completion) => void; timeZone: string }) {
  const outcomes = workOutcomes[type] as readonly string[]
  return <div className="grid gap-4 sm:grid-cols-2">
    <FormField id="completion-outcome" label="Outcome"><CrmSelect id="completion-outcome" required className={`${selectClass} w-full`} value={outcomes.includes(value.outcome) ? value.outcome : ""} onValueChange={event => onChange({ ...value, outcome: event })}><option value="">Choose an outcome</option>{outcomes.map(outcome => <option key={outcome} value={outcome}>{outcome.replaceAll("_", " ")}</option>)}</CrmSelect></FormField>
    <FormField id="completion-when" label={`When it happened (${timeZone})`}><Input id="completion-when" type="datetime-local" required value={value.when} onChange={event => onChange({ ...value, when: event.target.value })} /></FormField>
    <FormField id="completion-duration" label="Actual duration, minutes (optional)"><Input id="completion-duration" type="number" min={0} max={1440} value={value.duration} onChange={event => onChange({ ...value, duration: event.target.value })} /></FormField>
    <FormField id="completion-summary" label="Customer interaction summary" className="sm:col-span-2"><CrmTextarea id="completion-summary" required maxLength={5000} placeholder="What was discussed, what the customer needs, and what should happen next…" value={value.summary} onChange={event => onChange({ ...value, summary: event.target.value })} /><p className="text-xs text-muted-foreground">Shared with staff who can access this customer. Put private preparation details in the activity’s internal notes.</p></FormField>
  </div>
}
export const WorkEditor = withCrmRecordView(WorkEditorBody)
function WorkEditorBody({ id, initial = {} }: { id?: string; initial?: Initial }) {
  const view = useCrmRecordView()!
  const router = useRouter()
  const { data: session } = useSession()
  const [record, setRecord] = React.useState<CrmWorkRow | null>(null)
  const [contactId, setContactId] = React.useState(initial.contactId || "")
  const [contact, setContact] = React.useState<CrmWorkRow["contact"] | null>(null)
  const [relationKind, setRelationKind] = React.useState(initial.enquiryId ? "enquiry" : initial.opportunityId ? "opportunity" : "contact")
  const [relationId, setRelationId] = React.useState(initial.enquiryId || initial.opportunityId || "")
  const [relation, setRelation] = React.useState<{ id: string; title: string } | null>(null)
  const [values, setValues] = React.useState<WorkFormValues>(emptyWork)
  const [next, setNext] = React.useState<WorkFormValues>(emptyWork)
  const [completion, setCompletion] = React.useState<Completion>(emptyCompletion)
  const [scheduleNext, setScheduleNext] = React.useState(false)
  const [logOnly, setLogOnly] = React.useState(initial.log === "true")
  const [timeZone, setTimeZone] = React.useState("UTC")
  const [historyFormat, setHistoryFormat] = React.useState(defaultWorkHistoryFormat)
  const [canAssign, setCanAssign] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const review = useFollowUpReview(record?.canEdit && ["OPEN", "IN_PROGRESS"].includes(record.status) ? id : undefined, record?.version, completion.outcome, revision)
  React.useEffect(() => {
    const controller = new AbortController()
    const get = async (url: string) => { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load activity."); return data }
    void (async () => {
      try {
        const [assignees, settings, existing] = await Promise.all([get("/api/crm/assignees"), get("/api/settings/display"), id ? get(`/api/crm/work/${id}`) : null])
        const tz = existing?.timeZone || settings.settings?.timeZone || "UTC", today = wallTime(new Date(), tz).slice(0, 10)
        setTimeZone(tz); setCanAssign(assignees.canAssign); setCompletion({ ...emptyCompletion, when: wallTime(new Date(), tz) })
        setHistoryFormat({ timeZone: tz, locale: settings.settings?.locale || defaultWorkHistoryFormat.locale, dateFormat: settings.settings?.dateFormat || defaultWorkHistoryFormat.dateFormat, timeFormat: settings.settings?.timeFormat === "H12" ? "H12" : "H24" })
        if (existing) { setRecord(existing); setContactId(existing.contactId); setContact(existing.contact); setValues(workForm(existing, tz)) }
        else setValues({ ...emptyWork, assignedUserId: assignees.currentUserId, dueOn: initial.dueOn || today, type: initial.log === "true" ? "CALL" : "TASK", callDirection: initial.log === "true" ? "OUTBOUND" : null, startsLocal: initial.startsAt ? wallTime(initial.startsAt, tz) : "", endsLocal: initial.endsAt ? wallTime(initial.endsAt, tz) : "" })
        setNext({ ...emptyWork, title: "Next follow-up", assignedUserId: existing?.assignedUserId || assignees.currentUserId, dueOn: new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), type: "CALL", callDirection: "OUTBOUND" })
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setFailed(true) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [id, initial.dueOn, initial.log, initial.startsAt, initial.endsAt])
  React.useEffect(() => {
    if (id || relationKind === "contact" || !relationId) return
    const controller = new AbortController()
    void fetch(`/api/crm/${relationKind === "enquiry" ? "enquiries" : "opportunities"}/${relationId}`, { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load related record."); setRelation({ id: data.id, title: data.title }); setContactId(data.contact.id) }).catch(error => { if (!controller.signal.aborted) { setRelation(null); setError(error.message) } })
    return () => controller.abort()
  }, [id, relationKind, relationId])
  React.useEffect(() => {
    if (id || !contactId) return
    const controller = new AbortController()
    void fetch(`/api/crm/contacts/${contactId}`, { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load customer."); setContact(data) }).catch(error => { if (!controller.signal.aborted) { setContact(null); setError(error.message) } })
    return () => controller.abort()
  }, [id, contactId])
  async function request(path: string, method: string, body: unknown) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save activity.") }
    return data
  }
  async function reload() {
    if (!id) return
    const response = await fetch(`/api/crm/work/${id}`, { cache: "no-store" }); const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Unable to refresh activity.")
    setRecord(data); setValues(workForm(data, timeZone)); setRevision(value => value + 1)
  }
  function completionPayload() { return { summary: completion.summary, outcome: completion.outcome, occurredAt: wallTimeToInstant(completion.when, timeZone), durationMinutes: completion.duration === "" ? null : Number(completion.duration) } }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const payload = workPayload(!id && logOnly ? { ...values, dueOn: completion.when.slice(0, 10), startsLocal: "", endsLocal: "", reminderLocal: "" } : values, timeZone)
      const data = await request(id ? `/api/crm/work/${id}` : "/api/crm/work", id ? "PATCH" : "POST", { ...payload, ...(id ? { version: record?.version, status: record?.status } : { contactId, enquiryId: relationKind === "enquiry" ? relationId : "", opportunityId: relationKind === "opportunity" ? relationId : "", ...(logOnly ? { completion: completionPayload() } : {}) }) })
      toast.success(logOnly && !id ? "Interaction logged." : "Activity saved.")
      if (!id) router.push(`/crm/activities/${data.id}`)
      else { setRecord(data); setValues(workForm(data, timeZone)); setRevision(value => value + 1); view.done() }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  async function finish(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try { await request(`/api/crm/work/${id}/complete`, "POST", { ...completionPayload(), version: record?.version, ...(review.decision ? { ruleDecision: review.decision } : {}), ...(scheduleNext && !review.applying ? { followUp: workPayload(next, timeZone) } : {}) }); await reload(); toast.success(scheduleNext || review.applying ? "Completed and next follow-up scheduled." : "Activity completed.") }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  async function reminder(action: "SNOOZE" | "DISMISS", minutes?: number) {
    setSaving(true); setError("")
    try { await request(`/api/crm/work/${id}/reminder`, "POST", { version: record?.version, action, ...(minutes ? { minutes } : {}) }); await reload(); toast.success(action === "SNOOZE" ? "Reminder snoozed." : "Reminder dismissed.") }
    catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  async function cancel() {
    setSaving(true); setError("")
    try { await request(`/api/crm/work/${id}/cancel`, "POST", { version: record?.version, reason: cancelReason }); setCancelOpen(false); await reload(); toast.success("Activity cancelled.") }
    catch (error) { setError((error as Error).message); setCancelOpen(false) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading activity…</p>
  const open = !record || record.status === "OPEN" || record.status === "IN_PROGRESS"
  const editable = !failed && (!id || !!record?.canEdit) && open
  const person = record?.assignee || { id: values.assignedUserId, name: session?.user?.name || "Me" }
  const relatedReady = id || relationKind === "contact" || relation?.id === relationId
  return <div className={crmPageClass}>
    <CrmPageHeader title={id ? record?.title || "Activity" : logOnly ? "Log customer interaction" : "Schedule activity"} backHref="/crm/activities" backLabel="Back to My Work" actions={<CrmFormActions form="work-form" cancelHref="/crm/activities" saving={saving} canSave={editable} disabled={!contactId || !relatedReady} saveLabel={!id && logOnly ? "Save interaction" : "Save activity"}>{id && <Button type="button" variant="outline" disabled={saving} onClick={() => void reload().catch(error => setError(error.message))}>Refresh</Button>}{id && editable && <><Button type="button" disabled={saving} onClick={() => view.setTab("outcome")}>Record outcome</Button><Button type="button" variant="outline" disabled={saving} onClick={() => setCancelOpen(true)}>Cancel activity</Button></>}</CrmFormActions>} />

    {contact?.id === contactId && <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4"><strong>{contact.name}</strong>{contact.phone && <a className="underline" href={`tel:${contact.phone}`}>{contact.phone}</a>}{contact.email && <span>{contact.email}</span>}{record?.parent && <Link className="text-sm underline" href={`/crm/${record.parent.kind === "enquiry" ? "enquiries" : "opportunities"}/${record.parent.id}`}>{record.parent.title}</Link>}{record && <span className="text-sm">{record.status.replaceAll("_", " ")}</span>}</div>}
    <CrmRecordForm id="work-form" onSubmit={save} initialSection="Activity details" saving={saving} disabled={!editable} error={error} fingerprint={{ values, status: record?.status }} overview={record && <><CrmSummarySection title="Activity details" canEdit={editable} fields={[
      { label: "Activity title", value: record?.title }, { label: "Activity type", value: record?.activityTypeName || record?.type },
      { label: "Assigned staff", value: record?.assignee.name }, { label: "Status", value: record?.status.replaceAll("_", " ") },
      { label: "Priority", value: record?.priority === 1 ? "Low" : record?.priority === 3 ? "High" : "Normal" },
      { label: "Due date", value: formatDateForDisplay(record?.dueOn, historyFormat.dateFormat) }, { label: `Scheduled time (${timeZone})`, value: record?.startsAt ? `${wallTime(record.startsAt, timeZone).replace("T", " ")}${record.endsAt ? ` to ${wallTime(record.endsAt, timeZone).replace("T", " ")}` : ""}` : "All day" },
      { label: `Reminder (${timeZone})`, value: record?.reminderAt ? wallTime(record.reminderAt, timeZone).replace("T", " ") : "None" },
      { label: "Call direction", value: record?.callDirection }, { label: "Staff instructions / preparation", value: record?.description },
    ]} />    {record?.summary && <CrmSection title={<>Recorded outcome: {record.outcome?.replaceAll("_", " ")}</>}> <p className="whitespace-pre-wrap break-words">{record.summary}</p></CrmSection>}
    {record?.cancellationReason && <p>Cancellation reason: {record.cancellationReason}</p>}
    {record?.followUpRuleName && <p className="text-sm">Created by {record.followUpRuleName}, version {record.followUpRuleVersion}. Follow-up {record.automationDepth} in this chain.</p>}
    {record?.planLaunch && <p className="text-sm">From {record.planLaunch.planName}, version {record.planLaunch.planVersion}, step {(record.planPosition ?? 0) + 1}. <Link className="underline" href={`/crm/activities?scope=visible&state=all&planLaunchId=${record.planLaunchId}`}>View plan activities</Link></p>}
</>} tabs={record ? [
      ...(open && record.canEdit ? [{ value: "outcome", label: "Outcome and next step", content: <>    {record && open && record.canEdit && <>
      {record.reminderAt && record.assignedUserId === session?.user?.id && <CrmSection title={<>Reminder</>}> <p className="text-sm">{record.reminderDismissedAt ? "Dismissed" : record.snoozedUntil ? `Snoozed until ${wallTime(record.snoozedUntil, timeZone).replace("T", " ")}` : `Scheduled for ${wallTime(record.reminderAt, timeZone).replace("T", " ")}`} ({timeZone}). The activity stays open until completed or cancelled.</p><div className="flex flex-wrap gap-2">{[15, 60, 1440].map(minutes => <Button key={minutes} variant="outline" disabled={saving} onClick={() => void reminder("SNOOZE", minutes)}>Snooze {minutes === 1440 ? "1 day" : minutes === 60 ? "1 hour" : "15 min"}</Button>)}<Button variant="outline" disabled={saving} onClick={() => void reminder("DISMISS")}>Dismiss reminder</Button></div></CrmSection>}
      <form onSubmit={finish}><CrmSection title="Record outcome and next step"><fieldset disabled={saving} className="space-y-5"><CompletionFields type={record.type} value={completion} onChange={setCompletion} timeZone={timeZone} /><FollowUpReview review={review} />{!review.applying && <><label className="flex items-center gap-2 text-sm"><CrmCheckbox  checked={scheduleNext} onChange={event => setScheduleNext(event.target.checked)} />Schedule a manual follow-up</label>{scheduleNext && <WorkScheduleFields prefix="next" values={next} onChange={setNext} canAssign={canAssign} assignee={person} timeZone={timeZone} />}</>}</fieldset><CrmActionBar><Button type="submit" loading={saving} disabled={!review.ready}>{review.applying ? "Complete and create suggested follow-up" : scheduleNext ? "Complete and schedule next" : "Complete activity"}</Button></CrmActionBar></CrmSection></form>
    </>}
</> }] : []),
      { value: "interactions", label: "Customer interactions", content: <ContactInteractions contactId={contactId} revision={revision} /> },
      { value: "history", label: "History and notes", content: <WorkHistory id={record.id} revision={revision} canEdit={record.canEdit} settings={historyFormat} /> },
    ] : []}><CrmSection title="Activity details" description="Customer, assignment and schedule."><fieldset disabled={!editable || saving} className="space-y-5">
      {!id && <><label className="flex items-center gap-2 text-sm"><CrmCheckbox  checked={logOnly} onChange={event => setLogOnly(event.target.checked)} />Log an interaction that already happened</label><div className="grid gap-4 sm:grid-cols-2"><FormField id="work-related-kind" label="Related to"><CrmSelect id="work-related-kind" className={`${selectClass} w-full`} value={relationKind} onValueChange={event => { setRelationKind(event); setRelationId(""); setRelation(null) }}><option value="contact">Customer only</option><option value="enquiry">Enquiry</option><option value="opportunity">Opportunity</option></CrmSelect></FormField>{relationKind !== "contact" && <FormField id="work-related-id" label="Related record"><RecordSelect id="work-related-id" endpoint={`/api/crm/${relationKind === "enquiry" ? "enquiries" : "opportunities"}`} labelField="title" value={relationId} selected={relation ? { value: relation.id, label: relation.title } : undefined} onChange={setRelationId} /></FormField>}<FormField id="work-contact" label="Customer" error={errors.contactId}><RecordSelect id="work-contact" endpoint="/api/crm/contacts" value={contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={setContactId} disabled={relationKind !== "contact"} /></FormField></div></>}
      <WorkScheduleFields values={values} onChange={setValues} canAssign={canAssign} assignee={person} timeZone={timeZone} errors={errors} logOnly={!id && logOnly} />
      {!id && logOnly && <CompletionFields type={values.type} value={completion} onChange={setCompletion} timeZone={timeZone} />}
      {id && open && <FormField id="work-status" label="Work status"><CrmSelect id="work-status" className={selectClass} value={record?.status || "OPEN"} onValueChange={event => setRecord(previous => previous ? { ...previous, status: event as "OPEN" | "IN_PROGRESS" } : previous)}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option></CrmSelect></FormField>}
    </fieldset></CrmSection></CrmRecordForm>
    <Dialog open={cancelOpen} onOpenChange={open => { if (!saving) setCancelOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Cancel this activity?</DialogTitle><DialogDescription>The record and history will be kept. Its reminders will stop.</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); void cancel() }} className="space-y-4"><FormField id="cancel-reason" label="Reason"><CrmTextarea id="cancel-reason" required maxLength={2000} value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></FormField><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setCancelOpen(false)}>Keep activity</Button><Button type="submit" loading={saving}>Cancel activity</Button></DialogFooter></form></DialogContent></Dialog>
  </div>
}
