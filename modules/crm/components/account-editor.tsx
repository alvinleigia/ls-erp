"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { withRecordView, useRecordView, AccessRecordForm, AccessSummarySection } from "@/platform/access/record-view"
import { Section } from "@/components/erp/section"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Textarea, Checkbox } from "@/components/erp/controls"
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { CrmAccountRow } from "@/types/crm"
import { RecordList } from "./record-list"

export const AccountEditor = withRecordView(AccountEditorBody)
function AccountEditorBody({ id }: { id?: string }) {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const view = useRecordView()!
  const { loadAccess } = view
  const router = useRouter()
  const [account, setAccount] = React.useState<CrmAccountRow | null>(null)
  const [values, setValues] = React.useState({ name: "", email: "", phone: "", website: "", notes: "", archived: false })
  const [loading, setLoading] = React.useState(!!id)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    fetch(`/api/crm/accounts/${id}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || readTerm("crm.account.singular", "Unable to load account.", "Unable to load {label}."))
      setAccount(data); loadAccess(data.recordAccess); setValues({ name: data.name, email: data.email || "", phone: data.phone || "", website: data.website || "", notes: data.notes || "", archived: data.archived })
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [loadAccess, readTerm, id])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (account && !account.archived && values.archived) { setConfirmArchive(true); return }
    await persist()
  }
  async function persist() {
    setSaving(true); setError(""); clearErrors()
    try {
      const { archived, ...fields } = values
      const response = await fetch(id ? `/api/crm/accounts/${id}` : "/api/crm/accounts", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { ...fields, archived, version: account?.version } : fields) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || readTerm("crm.account.singular", "Unable to save account.", "Unable to save {label}.")) }
      view.done(); toast.success(term("crm.account.singular", "Business account saved.", "{label} saved.")); setConfirmArchive(false)
      if (!id) router.push(`/crm/accounts/${data.id}`)
      else setAccount({ ...data, canEdit: account?.canEdit })
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>{term("crm.account.singular", "Loading business account…", "Loading {label}…")}</p>
  const canEdit = !id || !!account?.canEdit
  return <div className={pageClass}>
      <AccessPageHeader title={id ? account?.name || term("crm.account.singular", "Business account") : term("crm.account.singular", "New business account", "New {label}")} backHref="/crm/accounts" backLabel={term("crm.account.plural", "Back to business accounts", "Back to {label}")} actions={<AccessFormActions form="account-form" cancelHref="/crm/accounts" saving={saving} disabled={false} canSave={canEdit} saveLabel={term("crm.account.singular", "Save account", "Save {label}")} />} />
    <AccessRecordForm id="account-form" onSubmit={save} saving={saving} error={error} disabled={!canEdit} fingerprint={values} initialSection="Account details"
      overview={account && <AccessSummarySection sectionKey="Account details" title={term("crm.account.singular", "Account details", "{label} details")} canEdit={canEdit} fields={[{ label: term("crm.account.singular", "Company"), value: account.name }, { label: "Email", value: account.email }, { label: "Phone", value: account.phone }, { label: "Website", value: account.website }, { label: "Notes", value: account.notes }, { label: "Status", value: account.archived ? "Archived" : "Active" }]} />}
      tabs={account ? [{ value: "contacts", permission: "contacts.read" as const, label: term("crm.contact.plural", "Contacts"), content: <><p className="text-sm text-muted-foreground">{term("crm.account.singular", "Manage company links", "Manage {label} links") + " " + term("crm.contact.singular", "from the contact's page.", "from the {label}'s page.")}</p><RecordList kind="contacts" accountId={account.id} /></> }] : []}>


      <Section sectionKey="Account details" title={term("crm.account.singular", "Account details", "{label} details")} description={term("crm.account.singular", "Company information and contact details.", "{label} information and contact details.")}><fieldset disabled={!canEdit || saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <FormField id="name" label={term("crm.account.singular", "Company name", "{label} name")} error={errors.name} className="sm:col-span-2"><Input id="name" value={values.name} required maxLength={160} onChange={event => setValues({ ...values, name: event.target.value })} /></FormField>
        <FormField id="email" label="Email" error={errors.email}><Input id="email" type="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} /></FormField>
        <FormField id="phone" label="Phone (include country code)" error={errors.phone}><Input id="phone" type="tel" placeholder="+919876543210" value={values.phone} onChange={event => setValues({ ...values, phone: event.target.value })} /></FormField>
        <FormField id="website" label="Website" error={errors.website} className="sm:col-span-2"><Input id="website" type="url" placeholder="https://example.com" value={values.website} onChange={event => setValues({ ...values, website: event.target.value })} /></FormField>
        <FormField id="notes" label="Notes" error={errors.notes} className="sm:col-span-2"><Textarea id="notes" maxLength={5000} value={values.notes} onChange={event => setValues({ ...values, notes: event.target.value })} /></FormField>
        {id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox  checked={values.archived} onChange={event => setValues({ ...values, archived: event.target.checked })} />Archived — keep relationships and stop new links</label>}
      </fieldset></Section>
      {account && !canEdit && <p className="text-sm text-muted-foreground">{term("crm.account.singular", "You can view this account", "You can view this {label}") + " " + term("crm.contact.singular", "through a contact. Ask its owner or a manager to edit it.", "through a {label}. Ask its owner or a manager to edit it.")}</p>}
    </AccessRecordForm>

    <Dialog open={confirmArchive} onOpenChange={open => { if (!saving) setConfirmArchive(open) }}><DialogContent><DialogHeader><DialogTitle>{term("crm.account.singular", "Archive this account?", "Archive this {label}?")}</DialogTitle><DialogDescription>{term("crm.contact.singular", "Existing contact relationships will be kept.", "Existing {label} relationships will be kept.") + " " + term("crm.account.singular", "New relationships cannot be added until the account is restored.", "New relationships cannot be added until the {label} is restored.")}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirmArchive(false)}>Cancel</Button><Button loading={saving} onClick={() => void persist()}>{term("crm.account.singular", "Archive account", "Archive {label}")}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
