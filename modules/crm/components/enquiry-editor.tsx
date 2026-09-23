"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { useFormErrors } from "@/hooks/use-form-errors"
import { enquiryStatuses } from "@/modules/crm/validation"
import type { CrmContactRow, CrmEnquiryRow, CrmStatus } from "@/types/crm"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { EnquiryTimeline } from "./enquiry-timeline"

export const textareaClass = "min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"

export function EnquiryEditor({ id, initialContactId }: { id?: string; initialContactId?: string }) {
  const router = useRouter()
  const { data: session } = useSession()
  const [enquiry, setEnquiry] = React.useState<CrmEnquiryRow | null>(null)
  const [contact, setContact] = React.useState<CrmContactRow | null>(null)
  const [values, setValues] = React.useState({ contactId: initialContactId || "", title: "", source: "", requirements: "", assignedUserId: "", status: "NEW" as CrmStatus, outcome: "" })
  const [canAssign, setCanAssign] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    async function get(url: string) {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load enquiry.")
      return data
    }
    void (async () => {
      try {
        const [assignees, record, selectedContact] = await Promise.all([
          get("/api/crm/assignees"), id ? get(`/api/crm/enquiries/${id}`) : null,
          !id && initialContactId ? get(`/api/crm/contacts/${initialContactId}`) : null,
        ])
        if (record) {
          setEnquiry(record); setContact(record.contact)
          setValues({ contactId: record.contact.id, title: record.title, source: record.source || "", requirements: record.requirements || "", assignedUserId: record.assignedUserId, status: record.status, outcome: record.outcome || "" })
        } else {
          setContact(selectedContact)
          setValues(previous => ({ ...previous, assignedUserId: assignees.currentUserId }))
        }
        setCanAssign(assignees.canAssign)
      } catch (error) {
        if (!controller.signal.aborted) { setError((error as Error).message); setLoadFailed(true) }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [id, initialContactId])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const base = { title: values.title, source: values.source, requirements: values.requirements, assignedUserId: values.assignedUserId }
      const payload = id ? { ...base, version: enquiry?.version, status: values.status, outcome: values.outcome } : { ...base, contactId: values.contactId }
      const response = await fetch(id ? `/api/crm/enquiries/${id}` : "/api/crm/enquiries", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save enquiry.") }
      toast.success("Enquiry saved.")
      if (!id) router.push(`/crm/enquiries/${data.id}`)
      else { setEnquiry(data); setRevision(value => value + 1) }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading enquiry…</p>
  const selectedAssignee = enquiry?.assignee ?? { id: values.assignedUserId, name: session?.user?.name || "Me" }
  return <div className="mx-auto max-w-4xl space-y-8">
    <form onSubmit={save} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{id ? "Enquiry" : "New enquiry"}</h1><div className="flex gap-2"><Button type="button" variant="outline" asChild><Link href="/crm/enquiries">Back</Link></Button><Button type="submit" loading={saving} loadingText="Saving…" disabled={loadFailed}>Save enquiry</Button></div></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <fieldset disabled={saving || loadFailed} className="grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
        <FormField id="contactId" label="Contact" error={errors.contactId}>
          {id ? <Link className="block py-2 underline" href={`/crm/contacts/${contact?.id}`}>{contact?.name}</Link> : <><RecordSelect id="contactId" endpoint="/api/crm/contacts" value={values.contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={contactId => setValues({ ...values, contactId })} /><Link className="text-sm underline" href="/crm/contacts/new">Create a contact first</Link></>}
        </FormField>
        <FormField id="assignedUserId" label="Salesperson" error={errors.assignedUserId}><RecordSelect id="assignedUserId" endpoint="/api/crm/assignees" value={values.assignedUserId} selected={{ value: selectedAssignee.id, label: selectedAssignee.name || "Unnamed user" }} onChange={assignedUserId => setValues({ ...values, assignedUserId })} disabled={!canAssign} /></FormField>
        <FormField id="title" label="Enquiry title" error={errors.title} className="sm:col-span-2"><Input id="title" required maxLength={200} value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} /></FormField>
        <FormField id="source" label="Source" error={errors.source}><Input id="source" placeholder="Website, referral, walk-in…" maxLength={100} value={values.source} onChange={event => setValues({ ...values, source: event.target.value })} /></FormField>
        {id && <FormField id="status" label="Status" error={errors.status}><select id="status" className={`${selectClass} w-full`} value={values.status} onChange={event => setValues({ ...values, status: event.target.value as CrmStatus })}>{enquiryStatuses.map(status => <option key={status}>{status}</option>)}</select></FormField>}
        <FormField id="requirements" label="Requirements" error={errors.requirements} className="sm:col-span-2"><textarea id="requirements" className={textareaClass} maxLength={5000} value={values.requirements} onChange={event => setValues({ ...values, requirements: event.target.value })} /></FormField>
        {id && <FormField id="outcome" label="Outcome (required when closed)" error={errors.outcome} className="sm:col-span-2"><textarea id="outcome" className={textareaClass} maxLength={2000} value={values.outcome} onChange={event => setValues({ ...values, outcome: event.target.value })} /></FormField>}
      </fieldset>
    </form>
    {enquiry && <EnquiryTimeline enquiryId={enquiry.id} closed={enquiry.status === "CLOSED"} revision={revision} />}
  </div>
}
