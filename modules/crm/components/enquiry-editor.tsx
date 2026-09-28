"use client"
import { PropertyFields, emptyProperty, propertyFields, useRealEstateEnabled } from "@/modules/real-estate/components/property-fields"
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
import { useFormErrors } from "@/hooks/use-form-errors"
import { enquiryStatuses } from "@/modules/crm/validation"
import type { CrmContactRow, CrmEnquiryRow, CrmStatus } from "@/types/crm"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { EnquiryTimeline } from "./enquiry-timeline"
import { ContactFields, emptyContact } from "./contact-fields"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { useDateFormatter } from "@/hooks/use-date-formatter"

export const textareaClass = "min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"

export function EnquiryEditor({ id, initialContactId, initialProjectId = "", initialSubprojectId = "" }: { id?: string; initialContactId?: string; initialProjectId?: string; initialSubprojectId?: string }) {
  const realEstateEnabled = useRealEstateEnabled()
  const [property, setProperty] = React.useState({ ...emptyProperty, projectId: initialProjectId, subprojectId: initialSubprojectId })
  const [propertyDirty, setPropertyDirty] = React.useState(!!initialProjectId)

  const router = useRouter()
  const { data: session } = useSession()
  const { formatDate } = useDateFormatter()
  const [contactMode, setContactMode] = React.useState("existing")
  const [newContact, setNewContact] = React.useState(emptyContact)
  const [referralType, setReferralType] = React.useState("none")
  const [enquiry, setEnquiry] = React.useState<CrmEnquiryRow | null>(null)
  const [contact, setContact] = React.useState<CrmContactRow | null>(null)
  const [values, setValues] = React.useState({ contactId: initialContactId || "", title: "", sourceId: "", accountId: "", referralContactId: "", referralAccountId: "", targetCloseOn: "", requirements: "", assignedUserId: "", status: "NEW" as CrmStatus, outcome: "" })
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
          setEnquiry(record); setContact(record.contact); setProperty(propertyFields(record.propertyContext)); setPropertyDirty(false)
          setValues({ contactId: record.contact.id, title: record.title, sourceId: record.sourceId || "", accountId: record.accountId || "", referralContactId: record.referralContactId || "", referralAccountId: record.referralAccountId || "", targetCloseOn: record.targetCloseOn?.slice(0, 10) || "", requirements: record.requirements || "", assignedUserId: record.assignedUserId, status: record.status, outcome: record.outcome || "" })
          setReferralType(record.referralContactId ? "contact" : record.referralAccountId ? "account" : "none")
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
      const base = { ...(propertyDirty ? { propertyContext: property } : {}), title: values.title, sourceId: values.sourceId, accountId: values.accountId, targetCloseOn: values.targetCloseOn, requirements: values.requirements, assignedUserId: values.assignedUserId,
        ...(!enquiry?.referralRestricted ? { referralContactId: values.referralContactId, referralAccountId: values.referralAccountId } : {}) }
      const payload = id ? { ...base, version: enquiry?.version, status: values.status, outcome: values.outcome } : { ...base, ...(contactMode === "new" ? { newContact } : { contactId: values.contactId }) }
      const response = await fetch(id ? `/api/crm/enquiries/${id}` : "/api/crm/enquiries", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save enquiry.") }
      toast.success("Enquiry saved.")
      if (!id) router.push(`/crm/enquiries/${data.id}`)
      else {
        setEnquiry(data); setProperty(propertyFields(data.propertyContext)); setPropertyDirty(false); setRevision(value => value + 1)
        try {
          const refreshed = await fetch(`/api/crm/enquiries/${id}`, { cache: "no-store" })
          if (!refreshed.ok) throw new Error("Refresh failed")
          setEnquiry(await refreshed.json())
        } catch { setError("Enquiry saved. Refresh to see the latest record information.") }
      }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading enquiry…</p>
  const selectedAssignee = enquiry?.assignee ?? { id: values.assignedUserId, name: session?.user?.name || "Me" }
  return <div className={crmPageClass}>
    <form id="enquiry-form" onSubmit={save} className="space-y-5">
      <CrmPageHeader title={id ? enquiry?.title || "Enquiry" : "New enquiry"} backHref="/crm/enquiries" backLabel="Back to enquiries" actions={<CrmFormActions form="enquiry-form" cancelHref="/crm/enquiries" saving={saving} disabled={loadFailed} canSave={true} saveLabel="Save enquiry">{enquiry && <>{enquiry.opportunity ? <Button variant="outline" asChild><Link href={`/crm/opportunities/${enquiry.opportunity.id}`}>Open opportunity</Link></Button> : enquiry.status !== "CLOSED" && <Button variant="outline" asChild><Link href={`/crm/opportunities/new?enquiryId=${enquiry.id}`}>Convert to opportunity</Link></Button>}</>}</CrmFormActions>} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <CrmSection title="Customer" description="Reuse an existing contact or create one with this enquiry."><fieldset disabled={saving || loadFailed} className="grid min-w-0 gap-5 sm:grid-cols-2">
        {!id && <FormField id="contact-mode" label="Contact selection" className="sm:col-span-2"><DropdownSelect id="contact-mode" value={contactMode} options={[{ value: "existing", label: "Existing contact" }, { value: "new", label: "New contact" }]} onValueChange={mode => { setContactMode(mode); setValues({ ...values, accountId: "" }) }} /></FormField>}
        {contactMode === "new" && !id ? <><ContactFields values={newContact} onChange={setNewContact} errors={errors} prefix="newContact." disabled={saving || loadFailed} />{errors.newContact && <p className="text-destructive sm:col-span-2">{errors.newContact}</p>}<FormField id="accountId" label="Buyer company (optional)" error={errors.accountId}><RecordSelect id="accountId" endpoint="/api/crm/accounts" value={values.accountId} onChange={accountId => setValues({ ...values, accountId })} />{values.accountId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, accountId: "" })}>Clear company</Button>}<p className="text-xs text-muted-foreground">The new contact will be linked to this company when you save.</p></FormField></> : <>
        <FormField id="contactId" label="Contact" error={errors.contactId}>
          {id ? <Link className="block py-2 underline" href={`/crm/contacts/${contact?.id}`}>{contact?.name}</Link> : <RecordSelect id="contactId" endpoint="/api/crm/contacts" value={values.contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={contactId => setValues({ ...values, contactId, accountId: "" })} />}
        </FormField>
        <FormField id="accountId" label="Buyer company (optional)" error={errors.accountId}><RecordSelect id="accountId" endpoint={values.contactId ? `/api/crm/contacts/${values.contactId}/accounts?activeOnly=true` : "/api/crm/accounts"} value={values.accountId} disabled={!values.contactId} selected={enquiry?.account ? { value: enquiry.account.id, label: enquiry.account.name } : undefined} onChange={accountId => setValues({ ...values, accountId })} />{values.accountId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, accountId: "" })}>Clear company</Button>}{values.contactId && <Link className="block text-xs underline" href={`/crm/contacts/${values.contactId}`} target="_blank" rel="noreferrer">Manage this contact’s company links</Link>}</FormField>
        </>}
      </fieldset></CrmSection>
      <CrmSection title="Enquiry details" description="Customer requirements, ownership and progress."><fieldset disabled={saving || loadFailed} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <FormField id="assignedUserId" label="Salesperson" error={errors.assignedUserId}><RecordSelect id="assignedUserId" endpoint="/api/crm/assignees" value={values.assignedUserId} selected={{ value: selectedAssignee.id, label: selectedAssignee.name || "Unnamed user" }} onChange={assignedUserId => setValues({ ...values, assignedUserId })} disabled={!canAssign} /></FormField>
        <FormField id="title" label="Enquiry title" error={errors.title} className="sm:col-span-2"><Input id="title" required maxLength={200} value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} /></FormField>
        <FormField id="sourceId" label="Lead source (optional)" error={errors.sourceId}><RecordSelect id="sourceId" endpoint="/api/crm/lead-sources" value={values.sourceId} selected={enquiry?.sourceId ? { value: enquiry.sourceId, label: `${enquiry.source || enquiry.leadSource?.name || "Source"}${enquiry.leadSource?.archived ? " (archived)" : ""}` } : undefined} onChange={sourceId => setValues({ ...values, sourceId })} />{values.sourceId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, sourceId: "" })}>Clear source</Button>}{canAssign && <Link className="block text-xs underline" href="/crm/lead-sources" target="_blank" rel="noreferrer">Manage lead sources</Link>}</FormField>
        <FormField id="targetCloseOn" label="Target close date (optional)" error={errors.targetCloseOn}><Input id="targetCloseOn" type="date" value={values.targetCloseOn} onChange={event => setValues({ ...values, targetCloseOn: event.target.value })} /></FormField>
        {id && <FormField id="status" label="Status" error={errors.status}><CrmSelect id="status" className={`${selectClass} w-full`} value={values.status} onValueChange={event => setValues({ ...values, status: event as CrmStatus })}>{enquiryStatuses.map(status => <option key={status}>{status}</option>)}</CrmSelect></FormField>}
        <FormField id="requirements" label="Requirements" error={errors.requirements} className="sm:col-span-2"><CrmTextarea id="requirements" className={textareaClass} maxLength={5000} value={values.requirements} onChange={event => setValues({ ...values, requirements: event.target.value })} /></FormField>
        {id && <FormField id="outcome" label="Outcome (required when closed)" error={errors.outcome} className="sm:col-span-2"><CrmTextarea id="outcome" className={textareaClass} maxLength={2000} value={values.outcome} onChange={event => setValues({ ...values, outcome: event.target.value })} /></FormField>}
      </fieldset></CrmSection>
      <CrmSection title="Referral (optional)" description="Who introduced this enquiry, separate from the buyer’s company."><fieldset disabled={saving || loadFailed || enquiry?.referralRestricted} className="grid gap-5 sm:grid-cols-2">{enquiry?.referralRestricted ? <p className="text-sm text-muted-foreground sm:col-span-2">Referral details are restricted. They will be preserved when you save.</p> : <><FormField id="referral-type" label="Referred by"><DropdownSelect id="referral-type" className="w-full" value={referralType} options={[{ value: "none", label: "No referral" }, { value: "contact", label: "Person" }, { value: "account", label: "Company" }]} onValueChange={type => { setReferralType(type); setValues({ ...values, referralContactId: "", referralAccountId: "" }) }} /></FormField>{referralType !== "none" && <FormField id="referrer" label={referralType === "contact" ? "Referring person" : "Referring company"}><RecordSelect key={referralType} id="referrer" endpoint={`/api/crm/${referralType === "contact" ? "contacts" : "accounts"}`} value={referralType === "contact" ? values.referralContactId : values.referralAccountId} selected={enquiry?.referralContact ? { value: enquiry.referralContact.id, label: enquiry.referralContact.name } : enquiry?.referralAccount ? { value: enquiry.referralAccount.id, label: enquiry.referralAccount.name } : undefined} onChange={value => setValues({ ...values, referralContactId: referralType === "contact" ? value : "", referralAccountId: referralType === "account" ? value : "" })} /></FormField>}</>}</fieldset></CrmSection>
      {(id ? enquiry?.realEstateEnabled : realEstateEnabled) && <PropertyFields error={errors.propertyContext} value={property} selected={enquiry?.propertyContext} disabled={saving || loadFailed} onChange={value => { setProperty(value); setPropertyDirty(true) }} />}
    </form>
    {enquiry && <CrmSection title="Record information"><dl className="grid gap-4 text-sm sm:grid-cols-3">{(["created", "updated", "assigned"] as const).map(key => <div key={key}><dt className="capitalize text-muted-foreground">{key}</dt><dd>{formatDate(enquiry.metadata?.[key]?.createdAt || (key === "created" ? enquiry.createdAt : key === "updated" ? enquiry.updatedAt : undefined)) || "Not recorded"}</dd><dd className="text-muted-foreground">{enquiry.metadata?.[key]?.actor.name || "Actor not recorded"}</dd></div>)}</dl></CrmSection>}
    {enquiry && <><EnquiryTimeline enquiryId={enquiry.id} contactId={enquiry.contact.id} revision={revision} /></>}
  </div>
}
