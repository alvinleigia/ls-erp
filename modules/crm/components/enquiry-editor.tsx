"use client"
import { IntroductionSelection, IntroductionDetails, introductionFields } from "@/platform/collaborators/introduction-controls"
import { useCreationOfficeSnapshot } from "@/platform/companies/creation-snapshot"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { withRecordView, useRecordView, AccessRecordForm, AccessSummarySection, AccessSectionEdit } from "@/platform/access/record-view"
import { SalesTeamSelect } from "@/platform/teams/controls"
import { useCustomFields } from "./custom-fields"
import { LostReasonFields } from "./lost-reason-fields"
import type { CrmViewReferences } from "../view-context"
import { useCrmExtensionEditor } from "./extension-provider"
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
import { useFormErrors } from "@/hooks/use-form-errors"
import { enquiryStatuses } from "@/modules/crm/validation"
import type { CrmContactRow, CrmEnquiryRow, CrmStatus } from "@/types/crm"
import { RecordSelect } from "@/components/erp/record-select"
import { selectClass } from "./record-list"
import { WorkList } from "./work-list"
import { EnquiryTimeline } from "./enquiry-timeline"
import { ContactFields, emptyContact } from "./contact-fields"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { useDateFormatter } from "@/hooks/use-date-formatter"

export const textareaClass = "min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"

export const EnquiryEditor = withRecordView(EnquiryEditorBody)
function EnquiryEditorBody({ id, initialContactId, initialReferences }: { id?: string; initialContactId?: string; initialReferences?: CrmViewReferences }) {
  const creationHeaders = useCreationOfficeSnapshot(!id)
  const { can } = useBusinessModules()
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const allowedAssignment = useCurrentResourceAction("assign")
  const canEdit = useCurrentResourceAction("edit")
  const extension = useCrmExtensionEditor(initialReferences)
  const loadExtension = extension.load
  const custom = useCustomFields("enquiry", id)
  const loadCustom = custom.load

  const view = useRecordView()!
  const { loadAccess } = view
  const router = useRouter()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id || "", canReadDirectory = can("assignmentTargets.read")
  const { formatDate } = useDateFormatter()
  const [contactMode, setContactMode] = React.useState("existing")
  const [newContact, setNewContact] = React.useState(emptyContact)
  const [referralType, setReferralType] = React.useState("none")
  const [enquiry, setEnquiry] = React.useState<CrmEnquiryRow | null>(null)
  const [contact, setContact] = React.useState<CrmContactRow | null>(null)
  const [values, setValues] = React.useState({ salesTeamId: "", contactId: initialContactId || "", title: "", sourceId: "", accountId: "", referralContactId: "", referralAccountId: "", targetCloseOn: "", requirements: "", assignedUserId: "", status: "NEW" as CrmStatus, outcome: "", lostReasonId: "" })
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [introducedByCollaboratorId, setIntroducer] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    async function get(url: string) {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || readTerm("crm.enquiry.singular", "Unable to load enquiry.", "Unable to load {label}."))
      return data
    }
    void (async () => {
      try {
        const [assignees, record, selectedContact] = await Promise.all([
          optionalReference<AssignmentContext>("/api/crm/assignees", canReadDirectory, controller.signal), id ? get(`/api/crm/enquiries/${id}`) : null,
          !id && initialContactId ? get(`/api/crm/contacts/${initialContactId}`) : null,
        ])
        if (record) {
          setEnquiry(record); loadAccess(record.recordAccess); setContact(record.contact); loadExtension(record); await loadCustom(record)
          setValues({ salesTeamId: record.salesTeamId || "", contactId: record.contact.id, title: record.title, sourceId: record.sourceId || "", accountId: record.accountId || "", referralContactId: record.referralContactId || "", referralAccountId: record.referralAccountId || "", targetCloseOn: record.targetCloseOn?.slice(0, 10) || "", requirements: record.requirements || "", assignedUserId: record.assignedUserId, status: record.status, outcome: record.outcome || "", lostReasonId: record.lostReasonId || "" })
          setReferralType(record.referralContactId ? "contact" : record.referralAccountId ? "account" : "none")
        } else {
          setContact(selectedContact)
          setValues(previous => ({ ...previous, assignedUserId: assignees?.currentUserId || currentUserId }))
        }
      } catch (error) {
        if (!controller.signal.aborted) { setError((error as Error).message); setLoadFailed(true) }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [loadAccess, readTerm, id, initialContactId, loadExtension, loadCustom, currentUserId, canReadDirectory])
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); clearErrors()
    try {
      const base = { salesTeamId: values.salesTeamId || null, ...extension.payload, ...custom.payload, title: values.title, sourceId: values.sourceId, accountId: values.accountId, targetCloseOn: values.targetCloseOn, requirements: values.requirements, assignedUserId: values.assignedUserId,
        ...(!enquiry?.referralRestricted ? { referralContactId: values.referralContactId, referralAccountId: values.referralAccountId } : {}) }
      const payload = id ? { ...base, version: enquiry?.version, status: values.status, outcome: values.outcome, lostReasonId: values.lostReasonId } : { ...base, ...(introducedByCollaboratorId ? { introducedByCollaboratorId } : {}), ...(contactMode === "new" ? { newContact } : { contactId: values.contactId }) }
      const response = await fetch(id ? `/api/crm/enquiries/${id}` : "/api/crm/enquiries", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", ...await creationHeaders() }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || readTerm("crm.enquiry.singular", "Unable to save enquiry.", "Unable to save {label}.")) }
      view.done(); toast.success(term("crm.enquiry.singular", "Enquiry saved.", "{label} saved."))
      if (!id) router.push(`/crm/enquiries/${data.id}`)
      else {
        setEnquiry(data); setValues(previous => ({ ...previous, lostReasonId: data.lostReasonId || "" })); loadExtension(data); await loadCustom(data); setRevision(value => value + 1)
        try {
          const refreshed = await fetch(`/api/crm/enquiries/${id}`, { cache: "no-store" })
          if (!refreshed.ok) throw new Error("Refresh failed")
          setEnquiry(await refreshed.json())
        } catch { setError(term("crm.enquiry.singular", "Enquiry saved. Refresh to see the latest record information.", "{label} saved. Refresh to see the latest record information.")) }
      }
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>{term("crm.enquiry.singular", "Loading enquiry…", "Loading {label}…")}</p>
  const selectedAssignee = enquiry?.assignee ?? { id: values.assignedUserId, name: session?.user?.name || "Me" }
  return <div className={pageClass}>
      <AccessPageHeader title={id ? enquiry?.title || term("crm.enquiry.singular", "Enquiry") : term("crm.enquiry.singular", "New enquiry", "New {label}")} backHref="/crm/enquiries" backLabel={term("crm.enquiry.plural", "Back to enquiries", "Back to {label}")} actions={<AccessFormActions form="enquiry-form" cancelHref="/crm/enquiries" saving={saving} disabled={loadFailed || custom.blocked} canSave={true} saveLabel={term("crm.enquiry.singular", "Save enquiry", "Save {label}")}>{enquiry && <>{enquiry.opportunity ? <Button variant="outline" asChild><Link href={`/crm/opportunities/${enquiry.opportunity.id}`}>{term("crm.opportunity.singular", "Open opportunity", "Open {label}")}</Link></Button> : enquiry.status !== "CLOSED" && canEdit && <Button variant="outline" asChild><Link href={`/crm/opportunities/new?enquiryId=${enquiry.id}`}>{term("crm.opportunity.singular", "Convert to opportunity", "Convert to {label}")}</Link></Button>}</>}</AccessFormActions>} />
    <AccessRecordForm id="enquiry-form" onSubmit={save} saving={saving} disabled={loadFailed || custom.blocked} error={error} fingerprint={{ introducedByCollaboratorId, values, referralType, extension: extension.payload, custom: custom.payload }} initialSection="Enquiry details" createSection="Customer"
      overview={enquiry && <>
        <AccessSummarySection title="Customer" fields={[{ label: term("crm.contact.singular", "Contact"), value: <Link href={`/crm/contacts/${enquiry.contact.id}`} className="underline">{enquiry.contact.name}</Link> }, { label: term("crm.account.singular", "Buyer company"), value: enquiry.account?.name }]} />
        <AccessSummarySection sectionKey="Enquiry details" title={term("crm.enquiry.singular", "Enquiry details", "{label} details")} fields={[{ label: "Title", value: enquiry.title }, { label: "Status", value: enquiry.status === "CLOSED" ? "Lost" : enquiry.status }, { label: "Salesperson", value: enquiry.assignee.name }, { label: "Sales team", value: enquiry.salesTeam?.name }, { label: "Source", value: enquiry.source }, { label: "Target close", value: formatDate(enquiry.targetCloseOn) }, { label: "Requirements", value: enquiry.requirements }, { label: "Lost reason", value: enquiry.lostReasonName }, { label: "Closing note", value: enquiry.outcome }]} />
        <AccessSummarySection title="Referral (optional)" canEdit={!enquiry.referralRestricted} fields={[{ label: "Referred by", value: enquiry.referralRestricted ? "Restricted" : enquiry.referralContact?.name || enquiry.referralAccount?.name }]} />
        <AccessSummarySection title="Introducing collaborator" canEdit={false} fields={introductionFields(enquiry)} />
        {extension.summary()} {custom.readOnlySection(<AccessSectionEdit section="Additional information" />)}
      </>}
      tabs={enquiry ? [{ value: "activities", permission: "activities.read" as const, label: term("crm.activity.plural", "Activities"), content: <WorkList enquiryId={enquiry.id} contactId={enquiry.contact.id} /> }, { value: "history", label: "History", content: <EnquiryTimeline enquiryId={enquiry.id} contactId={enquiry.contact.id} revision={revision} includeWork={false} /> }] : []}>


      <Section title="Customer" description={term("crm.contact.singular", "Reuse an existing contact", "Reuse an existing {label}") + " " + term("crm.enquiry.singular", "or create one with this enquiry.", "or create one with this {label}.")}><fieldset disabled={saving || loadFailed} className="grid min-w-0 gap-5 sm:grid-cols-2">
        {!id && <FormField id="contact-mode" label={term("crm.contact.singular", "Contact selection", "{label} selection")} className="sm:col-span-2"><DropdownSelect id="contact-mode" value={contactMode} options={[{ value: "existing", label: term("crm.contact.singular", "Existing contact", "Existing {label}") }, { value: "new", label: term("crm.contact.singular", "New contact", "New {label}") }]} onValueChange={mode => { setContactMode(mode); setValues({ ...values, accountId: "" }) }} /></FormField>}
        {contactMode === "new" && !id ? <><ContactFields values={newContact} onChange={setNewContact} errors={errors} prefix="newContact." disabled={saving || loadFailed} />{errors.newContact && <p className="text-destructive sm:col-span-2">{errors.newContact}</p>}<FormField id="accountId" label={term("crm.account.singular", "Buyer company (optional)", "{label} (optional)")} error={errors.accountId}><RecordSelect id="accountId" endpoint="/api/crm/accounts" value={values.accountId} onChange={accountId => setValues({ ...values, accountId })} />{values.accountId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, accountId: "" })}>{term("crm.account.singular", "Clear company", "Clear {label}")}</Button>}<p className="text-xs text-muted-foreground">{term("crm.contact.singular", "The new contact", "The new {label}") + " " + term("crm.account.singular", "will be linked to this company when you save.", "will be linked to this {label} when you save.")}</p></FormField></> : <>
        <FormField id="contactId" label={term("crm.contact.singular", "Contact")} error={errors.contactId}>
          {id ? <Link className="block py-2 underline" href={`/crm/contacts/${contact?.id}`}>{contact?.name}</Link> : <RecordSelect id="contactId" endpoint="/api/crm/contacts" value={values.contactId} selected={contact ? { value: contact.id, label: contact.name } : undefined} onChange={contactId => setValues({ ...values, contactId, accountId: "" })} />}
        </FormField>
        <FormField id="accountId" label={term("crm.account.singular", "Buyer company (optional)", "{label} (optional)")} error={errors.accountId}><RecordSelect id="accountId" endpoint={values.contactId ? `/api/crm/contacts/${values.contactId}/accounts?activeOnly=true` : "/api/crm/accounts"} value={values.accountId} disabled={!values.contactId} selected={enquiry?.account ? { value: enquiry.account.id, label: enquiry.account.name } : undefined} onChange={accountId => setValues({ ...values, accountId })} />{values.accountId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, accountId: "" })}>{term("crm.account.singular", "Clear company", "Clear {label}")}</Button>}{values.contactId && <Link className="block text-xs underline" href={`/crm/contacts/${values.contactId}`} target="_blank" rel="noreferrer">{term("crm.contact.singular", "Manage this contact’s", "Manage this {label}’s") + " " + term("crm.account.singular", "company links", "{label} links")}</Link>}</FormField>
        </>}
      </fieldset></Section>
      <Section sectionKey="Enquiry details" title={term("crm.enquiry.singular", "Enquiry details", "{label} details")} description="Customer requirements, ownership and progress."><fieldset disabled={saving || loadFailed} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <SalesTeamSelect value={values.salesTeamId} selected={enquiry?.salesTeam} disabled={!!id && !allowedAssignment} onChange={salesTeamId => { setValues({ ...values, salesTeamId }); void custom.changeTeam(salesTeamId) }} />
      <FormField id="assignedUserId" label="Salesperson" error={errors.assignedUserId}><RecordSelect id="assignedUserId" endpoint={values.salesTeamId ? `/api/crm/assignees?salesTeamId=${values.salesTeamId}` : "/api/crm/assignees"} value={values.assignedUserId} selected={{ value: selectedAssignee.id, label: selectedAssignee.name || "Unnamed user" }} onChange={assignedUserId => setValues({ ...values, assignedUserId })} disabled={!allowedAssignment || !canReadDirectory} /></FormField>
        <FormField id="title" label={term("crm.enquiry.singular", "Enquiry title", "{label} title")} error={errors.title} className="sm:col-span-2"><Input id="title" required maxLength={200} value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} /></FormField>
        <FormField id="sourceId" label="Lead source (optional)" error={errors.sourceId}><RecordSelect id="sourceId" endpoint="/api/crm/lead-sources" value={values.sourceId} selected={enquiry?.sourceId ? { value: enquiry.sourceId, label: `${enquiry.source || enquiry.leadSource?.name || "Source"}${enquiry.leadSource?.archived ? " (archived)" : ""}` } : undefined} onChange={sourceId => setValues({ ...values, sourceId })} />{values.sourceId && <Button type="button" variant="link" size="sm" onClick={() => setValues({ ...values, sourceId: "" })}>Clear source</Button>}{can("leadSources.edit") && <Link className="block text-xs underline" href="/crm/lead-sources" target="_blank" rel="noreferrer">Manage lead sources</Link>}</FormField>
        <FormField id="targetCloseOn" label="Target close date (optional)" error={errors.targetCloseOn}><Input id="targetCloseOn" type="date" value={values.targetCloseOn} onChange={event => setValues({ ...values, targetCloseOn: event.target.value })} /></FormField>
        {id && <FormField id="status" label="Status" error={errors.status}><Select id="status" className={`${selectClass} w-full`} value={values.status} onValueChange={event => setValues({ ...values, status: event as CrmStatus, lostReasonId: event === "CLOSED" ? values.lostReasonId : "" })}>{enquiryStatuses.map(status => <option key={status} value={status}>{status === "CLOSED" ? "Lost" : status}</option>)}</Select></FormField>}
        <FormField id="requirements" label="Requirements" error={errors.requirements} className="sm:col-span-2"><Textarea id="requirements" className={textareaClass} maxLength={5000} value={values.requirements} onChange={event => setValues({ ...values, requirements: event.target.value })} /></FormField>
        {id && values.status === "CLOSED" && <LostReasonFields value={values.lostReasonId} name={enquiry?.lostReasonName} note={values.outcome} legacy={enquiry?.status === "CLOSED" && !enquiry.lostReasonId} onReasonChange={lostReasonId => setValues({ ...values, lostReasonId })} onNoteChange={outcome => setValues({ ...values, outcome })} />}
        {id && values.status !== "CLOSED" && enquiry?.outcome && <p className="text-sm text-muted-foreground sm:col-span-2">Previous closing note: {enquiry.outcome}</p>}
        {id && enquiry?.status === "CLOSED" && <p className="text-sm text-muted-foreground sm:col-span-2">To reopen, choose New, Contacted or Qualified and save. History is preserved.</p>}
      </fieldset></Section>
      <Section title="Referral (optional)" description={term("crm.enquiry.singular", "Who introduced this enquiry, separate from the buyer’s company.", "Who introduced this {label}, separate from the buyer’s company.")}><fieldset disabled={saving || loadFailed || enquiry?.referralRestricted} className="grid gap-5 sm:grid-cols-2">{enquiry?.referralRestricted ? <p className="text-sm text-muted-foreground sm:col-span-2">Referral details are restricted. They will be preserved when you save.</p> : <><FormField id="referral-type" label="Referred by"><DropdownSelect id="referral-type" className="w-full" value={referralType} options={[{ value: "none", label: "No referral" }, { value: "contact", label: "Person" }, { value: "account", label: term("crm.account.singular", "Company") }]} onValueChange={type => { setReferralType(type); setValues({ ...values, referralContactId: "", referralAccountId: "" }) }} /></FormField>{referralType !== "none" && <FormField id="referrer" label={referralType === "contact" ? "Referring person" : "Referring company"}><RecordSelect key={referralType} id="referrer" endpoint={`/api/crm/${referralType === "contact" ? "contacts" : "accounts"}`} value={referralType === "contact" ? values.referralContactId : values.referralAccountId} selected={enquiry?.referralContact ? { value: enquiry.referralContact.id, label: enquiry.referralContact.name } : enquiry?.referralAccount ? { value: enquiry.referralAccount.id, label: enquiry.referralAccount.name } : undefined} onChange={value => setValues({ ...values, referralContactId: referralType === "contact" ? value : "", referralAccountId: referralType === "account" ? value : "" })} /></FormField>}</>}</fieldset></Section>
      {enquiry ? <IntroductionDetails record={enquiry} /> : <IntroductionSelection value={introducedByCollaboratorId} onChange={setIntroducer} disabled={saving || loadFailed} />}
      {extension.fields({ errors, disabled: saving || loadFailed })}
      {custom.section(saving || loadFailed)}
    </AccessRecordForm>
    {enquiry && <Section title="Record information"><dl className="grid gap-4 text-sm sm:grid-cols-3">{(["created", "updated", "assigned"] as const).map(key => <div key={key}><dt className="capitalize text-muted-foreground">{key}</dt><dd>{formatDate(enquiry.metadata?.[key]?.createdAt || (key === "created" ? enquiry.createdAt : key === "updated" ? enquiry.updatedAt : undefined)) || "Not recorded"}</dd><dd className="text-muted-foreground">{enquiry.metadata?.[key]?.actor.name || "Actor not recorded"}</dd></div>)}</dl></Section>}

  </div>
}
