"use client"
import { withCrmRecordView, useCrmRecordView, CrmRecordForm, CrmSummarySection } from "./crm-record-view"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmFormActions, crmPageClass } from "./crm-page"
import { CrmTextarea, CrmCheckbox } from "./crm-controls"
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

export const AccountEditor = withCrmRecordView(AccountEditorBody)
function AccountEditorBody({ id }: { id?: string }) {
  const view = useCrmRecordView()!
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
      if (!response.ok) throw new Error(data.error || "Unable to load account.")
      setAccount(data); setValues({ name: data.name, email: data.email || "", phone: data.phone || "", website: data.website || "", notes: data.notes || "", archived: data.archived })
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
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
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save account.") }
      view.done(); toast.success("Business account saved."); setConfirmArchive(false)
      if (!id) router.push(`/crm/accounts/${data.id}`)
      else setAccount({ ...data, canEdit: account?.canEdit })
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading business account…</p>
  const canEdit = !id || !!account?.canEdit
  return <div className={crmPageClass}>
      <CrmPageHeader title={id ? account?.name || "Business account" : "New business account"} backHref="/crm/accounts" backLabel="Back to business accounts" actions={<CrmFormActions form="account-form" cancelHref="/crm/accounts" saving={saving} disabled={false} canSave={canEdit} saveLabel="Save account" />} />
    <CrmRecordForm id="account-form" onSubmit={save} saving={saving} error={error} disabled={!canEdit} fingerprint={values} initialSection="Account details"
      overview={account && <CrmSummarySection title="Account details" canEdit={canEdit} fields={[{ label: "Company", value: account.name }, { label: "Email", value: account.email }, { label: "Phone", value: account.phone }, { label: "Website", value: account.website }, { label: "Notes", value: account.notes }, { label: "Status", value: account.archived ? "Archived" : "Active" }]} />}
      tabs={account ? [{ value: "contacts", label: "Contacts", content: <><p className="text-sm text-muted-foreground">Manage company links from the contact&apos;s page.</p><RecordList kind="contacts" accountId={account.id} /></> }] : []}>


      <CrmSection title="Account details" description="Company information and contact details."><fieldset disabled={!canEdit || saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
        <FormField id="name" label="Company name" error={errors.name} className="sm:col-span-2"><Input id="name" value={values.name} required maxLength={160} onChange={event => setValues({ ...values, name: event.target.value })} /></FormField>
        <FormField id="email" label="Email" error={errors.email}><Input id="email" type="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} /></FormField>
        <FormField id="phone" label="Phone (include country code)" error={errors.phone}><Input id="phone" type="tel" placeholder="+919876543210" value={values.phone} onChange={event => setValues({ ...values, phone: event.target.value })} /></FormField>
        <FormField id="website" label="Website" error={errors.website} className="sm:col-span-2"><Input id="website" type="url" placeholder="https://example.com" value={values.website} onChange={event => setValues({ ...values, website: event.target.value })} /></FormField>
        <FormField id="notes" label="Notes" error={errors.notes} className="sm:col-span-2"><CrmTextarea id="notes" maxLength={5000} value={values.notes} onChange={event => setValues({ ...values, notes: event.target.value })} /></FormField>
        {id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><CrmCheckbox  checked={values.archived} onChange={event => setValues({ ...values, archived: event.target.checked })} />Archived — keep relationships and stop new links</label>}
      </fieldset></CrmSection>
      {account && !canEdit && <p className="text-sm text-muted-foreground">You can view this account through a contact. Ask its owner or a manager to edit it.</p>}
    </CrmRecordForm>

    <Dialog open={confirmArchive} onOpenChange={open => { if (!saving) setConfirmArchive(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this account?</DialogTitle><DialogDescription>Existing contact relationships will be kept. New relationships cannot be added until the account is restored.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirmArchive(false)}>Cancel</Button><Button loading={saving} onClick={() => void persist()}>Archive account</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
