"use client"
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
import { workOutcomes } from "../work-validation"
import { wallTime, wallTimeToInstant } from "../work-time"
import type { CrmWorkRow, WorkType } from "@/types/crm-work"

type Initial = { contactId?: string; enquiryId?: string; opportunityId?: string; log?: string; dueOn?: string; startsAt?: string; endsAt?: string }
type Completion = { summary: string; outcome: string; when: string; duration: string }
const emptyCompletion: Completion = { summary: "", outcome: "", when: "", duration: "" }
function CompletionFields({ type, value, onChange, timeZone }: { type: WorkType; value: Completion; onChange: (value: Completion) => void; timeZone: string }) {
  const outcomes = workOutcomes[type] as readonly string[]
  return <div className="grid gap-4 sm:grid-cols-2">
    <FormField id="completion-outcome" label="Outcome"><select id="completion-outcome" required className={`${selectClass} w-full`} value={outcomes.includes(value.outcome) ? value.outcome : ""} onChange={event => onChange({ ...value, outcome: event.target.value })}><option value="">Choose an outcome</option>{outcomes.map(outcome => <option key={outcome} value={outcome}>{outcome.replaceAll("_", " ")}</option>)}</select></FormField>
    <FormField id="completion-when" label={`When it happened (${timeZone})`}><Input id="completion-when" type="datetime-local" required value={value.when} onChange={event => onChange({ ...value, when: event.target.value })} /></FormField>
    <FormField id="completion-duration" label="Actual duration, minutes (optional)"><Input id="completion-duration" type="number" min={0} max={1440} value={value.duration} onChange={event => onChange({ ...value, duration: event.target.value })} /></FormField>
    <FormField id="completion-summary" label="Customer interaction summary" className="sm:col-span-2"><textarea id="completion-summary" required maxLength={5000} className="min-h-32 w-full rounded border p-3" placeholder="What was discussed, what the customer needs, and what should happen next…" value={value.summary} onChange={event => onChange({ ...value, summary: event.target.value })} /><p className="text-xs text-muted-foreground">Shared with staff who can access this customer. Put private preparation details in the activity’s internal notes.</p></FormField>
  </div>
}
export function WorkEditor({ id, initial = {} }: { id?: string; initial?: Initial }) {
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
  const [canAssign, setCanAssign] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    const get = async (url: string) => { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load activity."); return data }
    void (async () => {
      try {
        const [assignees, settings, existing] = await Promise.all([get("/api/crm/assignees"), get("/api/settings"), id ? get(`/api/crm/work/${id}`) : null])
        const tz = existing?.timeZone || settings.settings?.timeZone || "UTC", today = wallTime(new Date(), tz).slice(0, 10)
        setTimeZone(tz); setCanAssign(assignees.canAssign); setCompletion({ ...emptyCompletion, when: wallTime(new Date(), tz) })
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
      else { setRecord(data); setValues(workForm(data, timeZone)); setRevision(value => value + 1) }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  async function finish(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("")
    try { await request(`/api/crm/work/${id}/complete`, "POST", { ...completionPayload(), version: record?.version, ...(scheduleNext ? { followUp: workPayload(next, timeZone) } : {}) }); await reload(); toast.success(scheduleNext ? "Completed and next follow-up scheduled." : "Activity completed.") }
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
  return <div className="mx-auto max-w-5xl space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{id ? record?.title || "Activity" : logOnly ? "Log customer interaction" : "Schedule activity"}</h1><div className="flex gap-2"><Button variant="outline" asChild><Link href="/crm/activities">My Work</Link></Button>{id && <Button variant="outline" disabled={saving} onClick={() => void reload().catch(error => setError(error.message))}>Refresh</Button>}</div></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {contact?.id === contactId && <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4"><strong>{contact.name}</strong>{contact.phone && <a className="underline" href={`tel:${contact.phone}`}>{contact.phone}</a>}{contact.email && <span>{contact.email}</span>}{record?.parent && <Link className="text-sm underline" href={`/crm/${record.parent.kind === "enquiry" ? "enquiries" : "opportunities"}/${record.parent.id}`}>{record.parent.title}</Link>}{record && <span className="text-sm">{record.status.replaceAll("_", " ")}</span>}</div>}
    <form onSubmit={save} className="space-y-5 rounded-xl border p-5"><fieldset disabled={!editable || saving} className="space-y-5">
      {!id && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={logOnly} onChange={event => setLogOnly(event.target.checked)} />Log an interaction that already happened</label><div className="grid gap-4 sm:grid-cols-2"><FormField id="work-related-kind" label="Related to"><select id="work-related-kind" className={`${selectClass} w-full`} value={relationKind} onChange={event => { setRelationKind(event.target.value); setRelationId(""); setRelation(null) }}><option value="contact">Customer only</option><option value="enquiry">Enquiry</option><option value="opportunity">Opportunity</option></select></FormField>{relationKind !== "contact" && <FormField id="work-related-id" label="Related record"><RecordSelect id="work-related-id" endpoint={`/api/crm/${relationKind === "enquiry" ? "enquiries" : "opportunities"}`} labelField="title" value={relationId} selected={relation ? { value: relation.id, label: relation.title } : undefined} onChange={setRelationId} /></FormField>}<FormField id="work-contact" label="Customer" error={errors.contactId}><RecordSelect id="work-contact" endpoint="/api/crm/contacts" value={contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={setContactId} disabled={relationKind !== "contact"} /></FormField></div></>}
      <WorkScheduleFields values={values} onChange={setValues} canAssign={canAssign} assignee={person} timeZone={timeZone} errors={errors} logOnly={!id && logOnly} />
      {!id && logOnly && <CompletionFields type={values.type} value={completion} onChange={setCompletion} timeZone={timeZone} />}
      {id && open && <FormField id="work-status" label="Work status"><select id="work-status" className={selectClass} value={record?.status || "OPEN"} onChange={event => setRecord(previous => previous ? { ...previous, status: event.target.value as "OPEN" | "IN_PROGRESS" } : previous)}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option></select></FormField>}
    </fieldset>{editable && <div className="flex gap-3"><Button type="submit" loading={saving} disabled={!contactId || !relatedReady}>{!id && logOnly ? "Save interaction" : "Save activity"}</Button>{id && <Button type="button" variant="outline" disabled={saving} onClick={() => setCancelOpen(true)}>Cancel activity</Button>}</div>}</form>
    {record?.summary && <section className="space-y-2 rounded-xl border p-5"><h2 className="font-semibold">Recorded outcome: {record.outcome?.replaceAll("_", " ")}</h2><p className="whitespace-pre-wrap break-words">{record.summary}</p></section>}
    {record?.cancellationReason && <p>Cancellation reason: {record.cancellationReason}</p>}
    {record && open && record.canEdit && <>
      {record.reminderAt && record.assignedUserId === session?.user?.id && <section className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">Reminder</h2><p className="text-sm">{record.reminderDismissedAt ? "Dismissed" : record.snoozedUntil ? `Snoozed until ${wallTime(record.snoozedUntil, timeZone).replace("T", " ")}` : `Scheduled for ${wallTime(record.reminderAt, timeZone).replace("T", " ")}`} ({timeZone}). The activity stays open until completed or cancelled.</p><div className="flex flex-wrap gap-2">{[15, 60, 1440].map(minutes => <Button key={minutes} variant="outline" disabled={saving} onClick={() => void reminder("SNOOZE", minutes)}>Snooze {minutes === 1440 ? "1 day" : minutes === 60 ? "1 hour" : "15 min"}</Button>)}<Button variant="outline" disabled={saving} onClick={() => void reminder("DISMISS")}>Dismiss reminder</Button></div></section>}
      <form onSubmit={finish} className="space-y-5 rounded-xl border p-5"><h2 className="text-lg font-semibold">Record outcome and next step</h2><fieldset disabled={saving} className="space-y-5"><CompletionFields type={record.type} value={completion} onChange={setCompletion} timeZone={timeZone} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scheduleNext} onChange={event => setScheduleNext(event.target.checked)} />Schedule the next follow-up</label>{scheduleNext && <WorkScheduleFields prefix="next" values={next} onChange={setNext} canAssign={canAssign} assignee={person} timeZone={timeZone} />}</fieldset><Button type="submit" loading={saving}>{scheduleNext ? "Complete and schedule next" : "Complete activity"}</Button></form>
    </>}
    {contactId && <ContactInteractions contactId={contactId} revision={revision} />}
    {record && <WorkHistory id={record.id} revision={revision} canEdit={record.canEdit} />}
    <Dialog open={cancelOpen} onOpenChange={open => { if (!saving) setCancelOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Cancel this activity?</DialogTitle><DialogDescription>The record and history will be kept. Its reminders will stop.</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); void cancel() }} className="space-y-4"><FormField id="cancel-reason" label="Reason"><textarea id="cancel-reason" required maxLength={2000} className="min-h-24 w-full rounded border p-3" value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></FormField><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setCancelOpen(false)}>Keep activity</Button><Button type="submit" loading={saving}>Cancel activity</Button></DialogFooter></form></DialogContent></Dialog>
  </div>
}
