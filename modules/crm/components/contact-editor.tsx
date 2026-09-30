"use client"
import { withCrmRecordView, useCrmRecordView, CrmRecordForm, CrmSummarySection } from "./crm-record-view"
import { CrmPageHeader, CrmFormActions } from "./crm-page"
import * as React from "react"
import Link from "@/platform/access/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ContactFields, emptyContact, contactValues } from "./contact-fields"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { CrmContactRow } from "@/types/crm"
import { ContactAccounts } from "./contact-accounts"
import { WorkList } from "./work-list"
import { ContactInteractions } from "./contact-interactions"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { CrmSection } from "./crm-section"

export const ContactEditor = withCrmRecordView(ContactEditorBody)
function ContactEditorBody({ id }: { id?: string }) {
  const view = useCrmRecordView()!
  const router = useRouter()
  const [contact, setContact] = React.useState<CrmContactRow | null>(null)
  const [values, setValues] = React.useState({ ...emptyContact, archived: false })
  const [loading, setLoading] = React.useState(!!id)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    fetch(`/api/crm/contacts/${id}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load contact.")
      setContact(data); setValues({ ...contactValues(data), archived: data.archived })
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (contact && !contact.archived && values.archived) { setConfirmArchive(true); return }
    await persist()
  }
  async function persist() {
    setSaving(true); setError(""); clearErrors()
    try {
      const payload = id ? { ...values, version: contact?.version } : contactValues(values)
      const response = await fetch(id ? `/api/crm/contacts/${id}` : "/api/crm/contacts", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save contact.") }
      view.done(); toast.success("Contact saved.")
      setConfirmArchive(false)
      if (!id) router.push(`/crm/contacts/${data.id}`)
      else setContact({ ...data, canEdit: contact?.canEdit })
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading contact…</p>
  const canEdit = !id || !!contact?.canEdit
  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
    <CrmPageHeader title={contact?.name || (id ? "Contact" : "New contact")} backHref="/crm/contacts" backLabel="Back to contacts" badge={contact && <span className="rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium">{contact.archived ? "Archived" : "Active"}</span>} actions={<CrmFormActions form="contact-details" cancelHref="/crm/contacts" canSave={canEdit} saving={saving} saveLabel="Save contact">{contact && !contact.archived && <Button type="button" variant="outline" asChild><Link href={"/crm/enquiries/new?contactId=" + contact.id}><Plus className="size-4" aria-hidden="true" />Create enquiry</Link></Button>}</CrmFormActions>} />
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {(!id || contact) && <div>
      <CrmRecordForm id="contact-details" onSubmit={save} saving={saving} error={error} disabled={!canEdit} fingerprint={values} initialSection="Contact details"
        overview={contact && <CrmSummarySection title="Contact details" canEdit={canEdit} fields={[{ label: "Name", value: contact.name }, { label: "Email", value: contact.email }, { label: "Phone", value: contact.phone }, { label: "Alternate phone", value: contact.alternatePhone }, { label: "WhatsApp", value: contact.whatsappPhone }, { label: "Address", value: [contact.addressLine1, contact.addressLine2, contact.city, contact.region, contact.postalCode, contact.country].filter(Boolean).join(", ") }, { label: "Status", value: contact.archived ? "Archived" : "Active" }]} />}
        tabs={contact ? [
          { value: "accounts", permission: "accounts.read" as const, label: "Business accounts", content: <ContactAccounts contactId={contact.id} canEdit={!!contact.canEdit} archived={contact.archived} /> },
          { value: "activities", permission: "activities.read" as const, label: "Activities", content: <WorkList contactId={contact.id} /> },
          { value: "history", permission: "activities.read" as const, label: "Interactions", content: <ContactInteractions contactId={contact.id} /> },
        ] : []}>
        <CrmSection title="Contact details" description="Basic information and contact status." icon={UserRound}>
          <fieldset disabled={!canEdit || saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
            <ContactFields values={values} onChange={next => setValues({ ...values, ...next })} errors={errors} disabled={!canEdit || saving} />
            {id && <FormField id="contact-status" label="Status"><DropdownSelect id="contact-status" label="Contact status" className="w-full" disabled={!canEdit || saving} value={values.archived ? "archived" : "active"} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} onValueChange={value => setValues({ ...values, archived: value === "archived" })} /></FormField>}
          </fieldset>
          {values.archived && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Archived contacts keep their history. Restore to Active to create new enquiries.</p>}
          {contact && !canEdit && <p className="text-sm text-muted-foreground">You can view this contact through assigned CRM work. Ask its owner or a manager to edit it.</p>}
        </CrmSection>
        <Dialog open={confirmArchive} onOpenChange={open => { if (!saving) setConfirmArchive(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this contact?</DialogTitle><DialogDescription>Existing enquiries and history will be kept. New enquiries cannot be created until the contact is restored.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmArchive(false)}>Cancel</Button><Button type="button" loading={saving} onClick={() => void persist()}>Archive contact</Button></DialogFooter></DialogContent></Dialog>
      </CrmRecordForm>

    </div>}

  </div>
}
