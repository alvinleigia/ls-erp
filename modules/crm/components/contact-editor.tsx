"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { CrmContactRow } from "@/types/crm"
import { ContactAccounts } from "./contact-accounts"

export function ContactEditor({ id }: { id?: string }) {
  const router = useRouter()
  const [contact, setContact] = React.useState<CrmContactRow | null>(null)
  const [values, setValues] = React.useState({ name: "", email: "", phone: "", archived: false })
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
      setContact(data); setValues({ name: data.name, email: data.email || "", phone: data.phone || "", archived: data.archived })
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
      const payload = id ? { ...values, version: contact?.version } : { name: values.name, email: values.email.trim(), phone: values.phone }
      const response = await fetch(id ? `/api/crm/contacts/${id}` : "/api/crm/contacts", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save contact.") }
      toast.success("Contact saved.")
      setConfirmArchive(false)
      if (!id) router.push(`/crm/contacts/${data.id}`)
      else setContact({ ...data, canEdit: contact?.canEdit })
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading contact…</p>
  const canEdit = !id || !!contact?.canEdit
  return <div className="mx-auto max-w-3xl space-y-8"><form onSubmit={save} className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{id ? "Contact" : "New contact"}</h1><div className="flex gap-2"><Button type="button" variant="outline" asChild><Link href="/crm/contacts">Back</Link></Button>{canEdit && <Button loading={saving} loadingText="Saving…" type="submit">Save contact</Button>}</div></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <fieldset disabled={!canEdit || saving} className="space-y-5 rounded-xl border p-5">
      <FormField id="name" label="Name" error={errors.name}><Input id="name" value={values.name} required maxLength={160} onChange={event => setValues({ ...values, name: event.target.value })} /></FormField>
      <FormField id="email" label="Email" error={errors.email}><Input id="email" type="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} /></FormField>
      <FormField id="phone" label="Phone (include country code)" error={errors.phone}><Input id="phone" type="tel" placeholder="+919876543210" value={values.phone} onChange={event => setValues({ ...values, phone: event.target.value })} /></FormField>
      {id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.archived} onChange={event => setValues({ ...values, archived: event.target.checked })} />Archived — keep history and stop new enquiries</label>}
    </fieldset>
    {contact && !contact.archived && <Button type="button" asChild><Link href={`/crm/enquiries/new?contactId=${contact.id}`}>Create enquiry</Link></Button>}
    {contact && !canEdit && <p className="text-sm text-muted-foreground">You can view this contact through an assigned enquiry. Ask its owner or a manager to edit it.</p>}
    <Dialog open={confirmArchive} onOpenChange={open => { if (!saving) setConfirmArchive(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this contact?</DialogTitle><DialogDescription>Existing enquiries and history will be kept. New enquiries cannot be created until the contact is restored.</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmArchive(false)}>Cancel</Button><Button type="button" loading={saving} onClick={() => void persist()}>Archive contact</Button></DialogFooter></DialogContent></Dialog>
  </form>
    {contact && <ContactAccounts contactId={contact.id} canEdit={!!contact.canEdit} archived={contact.archived} />}
  </div>
}
