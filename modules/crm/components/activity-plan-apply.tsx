"use client"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmFormActions, CrmActionBar, crmPageClass } from "./crm-page"
import { CrmSelect } from "./crm-controls"
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { wallTime } from "../work-time"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { ActivityPlanRow } from "@/types/crm-plans"
import type { WorkCreateInput } from "../work-validation"

type Initial = { planId?: string; contactId?: string; enquiryId?: string; opportunityId?: string }
export function ActivityPlanApply({ initial }: { initial: Initial }) {
  const router = useRouter(), { formatDate } = useDateFormatter()
  const [planId, setPlanId] = React.useState(initial.planId || ""), [plan, setPlan] = React.useState<ActivityPlanRow | null>(null)
  const [kind, setKind] = React.useState(initial.opportunityId ? "opportunity" : initial.enquiryId ? "enquiry" : "contact")
  const [parentId, setParentId] = React.useState(initial.opportunityId || initial.enquiryId || "")
  const [parent, setParent] = React.useState<{ id: string; title: string } | null>(null)
  const [contactId, setContactId] = React.useState(initial.contactId || ""), [contact, setContact] = React.useState<{ id: string; name: string } | null>(null)
  const [assignedUserId, setAssignedUserId] = React.useState(""), [me, setMe] = React.useState<{ id: string; name: string } | null>(null)
  const [canAssign, setCanAssign] = React.useState(false), [startOn, setStartOn] = React.useState("")
  const [timeZone, setTimeZone] = React.useState("UTC"), [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true), [busy, setBusy] = React.useState(false)
  const [preview, setPreview] = React.useState<{ signature: string; requestKey: string; steps: (WorkCreateInput & { activityTypeName?: string | null })[]; timeZone: string } | null>(null)
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    const get = async (url: string) => { const response = await fetch(url, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load options."); return data }
    void Promise.all([get("/api/crm/assignees"), get("/api/settings/display")]).then(([people, settings]) => { const tz = settings.settings?.timeZone || "UTC"; setTimeZone(tz); setStartOn(wallTime(new Date(), tz).slice(0, 10)); setAssignedUserId(people.currentUserId); setMe({ id: people.currentUserId, name: "Me" }); setCanAssign(people.canAssign) }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  React.useEffect(() => {
    if (!planId) return
    const controller = new AbortController()
    void fetch(`/api/crm/activity-plans/${planId}`, { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load plan."); setPlan(data) }).catch(error => { if (!controller.signal.aborted) { setPlan(null); setError(error.message) } })
    return () => controller.abort()
  }, [planId, revision])
  React.useEffect(() => {
    if (kind === "contact" || !parentId) return
    const controller = new AbortController()
    void fetch(`/api/crm/${kind === "opportunity" ? "opportunities" : "enquiries"}/${parentId}`, { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load related record."); setParent({ id: data.id, title: data.title }); setContactId(data.contact.id) }).catch(error => { if (!controller.signal.aborted) { setParent(null); setError(error.message) } })
    return () => controller.abort()
  }, [kind, parentId])
  React.useEffect(() => {
    if (!contactId) return
    const controller = new AbortController()
    void fetch(`/api/crm/contacts/${contactId}`, { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load customer."); setContact(data) }).catch(error => { if (!controller.signal.aborted) { setContact(null); setError(error.message) } })
    return () => controller.abort()
  }, [contactId])
  const input = { version: plan?.version, startOn, contactId, assignedUserId, enquiryId: kind === "enquiry" ? parentId : "", opportunityId: kind === "opportunity" ? parentId : "" }
  const signature = JSON.stringify({ planId, ...input })
  const ready = !!planId && plan?.id === planId && !plan.archived && !!startOn && contact?.id === contactId && !!assignedUserId && (kind === "contact" || parent?.id === parentId)
  const reviewed = preview?.signature === signature
  async function submit(apply: boolean) {
    if (!ready || (apply && !reviewed)) return
    setBusy(true); setError("")
    // Reuse the key after an uncertain network response, including preview retries.
    const requestKey = reviewed && preview ? preview.requestKey : crypto.randomUUID()
    try {
      const response = await fetch(`/api/crm/activity-plans/${planId}/${apply ? "apply" : "preview"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestKey }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to apply plan.")
      if (apply) { toast.success(`${data.count} activities scheduled.`); router.push(`/crm/activities?scope=visible&state=all&planLaunchId=${encodeURIComponent(data.id)}`) }
      else setPreview({ signature, requestKey, steps: data.steps, timeZone: data.timeZone })
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  if (loading) return <p>Loading activity plans…</p>
  return <section className={crmPageClass}><CrmPageHeader title="Apply activity plan" backHref="/crm/activity-plans" actions={<CrmFormActions form="apply-form" cancelHref="/crm/activity-plans" saving={busy} disabled={!ready} saveLabel="Preview schedule" loadingText="Preparing preview…"><Button type="button" variant="outline" disabled={busy} onClick={() => { setPreview(null); setRevision(value => value + 1); setError("") }}>Reload template</Button></CrmFormActions>} /><p className="text-sm text-muted-foreground">Review the dates before scheduling. All steps are assigned together, including steps due later. Existing activities remain in place.</p>{error && <p role="alert" className="text-destructive">{error}</p>}
    <form id="apply-form" onSubmit={event => { event.preventDefault(); void submit(false) }} className="space-y-4"><CrmSection title="Plan and assignment"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <FormField id="apply-plan" label="Activity plan"><RecordSelect id="apply-plan" endpoint="/api/crm/activity-plans" value={planId} selected={plan?.id === planId ? { value: plan.id, label: plan.name } : undefined} onChange={setPlanId} /></FormField>
      <FormField id="apply-kind" label="Related to"><CrmSelect id="apply-kind" className={`${selectClass} w-full`} value={kind} onValueChange={event => { setKind(event); setParentId(""); setParent(null) }}><option value="contact">Customer</option><option value="enquiry">Enquiry</option><option value="opportunity">Opportunity</option></CrmSelect></FormField>
      {kind !== "contact" && <FormField id="apply-parent" label="Related record"><RecordSelect id="apply-parent" endpoint={`/api/crm/${kind === "opportunity" ? "opportunities" : "enquiries"}`} labelField="title" value={parentId} selected={parent?.id === parentId ? { value: parent.id, label: parent.title } : undefined} onChange={setParentId} /></FormField>}
      <FormField id="apply-contact" label="Customer"><RecordSelect id="apply-contact" endpoint="/api/crm/contacts" value={contactId} selected={contact?.id === contactId ? { value: contact.id, label: contact.name } : undefined} onChange={setContactId} disabled={kind !== "contact"} /></FormField>
      <FormField id="apply-owner" label="Assigned staff"><RecordSelect id="apply-owner" endpoint="/api/crm/assignees" value={assignedUserId} selected={me ? { value: me.id, label: me.name } : undefined} onChange={setAssignedUserId} disabled={!canAssign} /></FormField>
      <FormField id="apply-start" label={`Start date (${timeZone})`}><Input id="apply-start" type="date" required value={startOn} onChange={event => setStartOn(event.target.value)} /></FormField>
    </fieldset></CrmSection></form>
    {plan?.archived && <p>This plan is archived. Choose an active plan.</p>}
    {reviewed && preview && <CrmSection title={<>{plan?.name}: {preview.steps.length}activities</>}> <p className="text-sm">All-day deadlines and reminders use {preview.timeZone}. Emails are tasks to carry out, not automatic messages.</p><ol className="space-y-3">{preview.steps.map((step, index) => <li key={index} className="rounded border p-3"><p className="font-medium">{index + 1}. {step.title}</p><p className="text-sm">{step.activityTypeName || step.type} · {formatDate(step.dueOn)}{step.reminderAt ? ` · Reminder ${wallTime(step.reminderAt, preview.timeZone).replace("T", " ")}` : ""}</p>{step.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{step.description}</p>}</li>)}</ol><CrmActionBar><Button disabled={!ready || busy} loading={busy} onClick={() => void submit(true)}>Schedule these activities</Button></CrmActionBar></CrmSection>}
  </section>
}
