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
import type { CrmAccountRow } from "@/types/crm"
import { RecordList } from "./record-list"

export function AccountEditor({ id }: { id?: string }) {
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
      toast.success("Business account saved."); setConfirmArchive(false)
      if (!id) router.push(`/crm/accounts/${data.id}`)
      else setAccount({ ...data, canEdit: account?.canEdit })
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading business account…</p>
  const canEdit = !id || !!account?.canEdit
  return <div className="mx-auto max-w-4xl space-y-8">
    <form onSubmit={save} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{id ? "Business account" : "New business account"}</h1><div className="flex gap-2"><Button type="button" variant="outline" asChild><Link href="/crm/accounts">Back</Link></Button>{canEdit && <Button type="submit" loading={saving} loadingText="Saving…">Save account</Button>}</div></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <fieldset disabled={!canEdit || saving} className="grid gap-5 rounded-xl border p-5 sm:grid-cols-2">
        <FormField id="name" label="Company name" error={errors.name} className="sm:col-span-2"><Input id="name" value={values.name} required maxLength={160} onChange={event => setValues({ ...values, name: event.target.value })} /></FormField>
        <FormField id="email" label="Email" error={errors.email}><Input id="email" type="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })} /></FormField>
        <FormField id="phone" label="Phone (include country code)" error={errors.phone}><Input id="phone" type="tel" placeholder="+919876543210" value={values.phone} onChange={event => setValues({ ...values, phone: event.target.value })} /></FormField>
        <FormField id="website" label="Website" error={errors.website} className="sm:col-span-2"><Input id="website" type="url" placeholder="https://example.com" value={values.website} onChange={event => setValues({ ...values, website: event.target.value })} /></FormField>
        <FormField id="notes" label="Notes" error={errors.notes} className="sm:col-span-2"><textarea id="notes" maxLength={5000} className="min-h-24 w-full rounded-md border bg-background p-3 text-sm" value={values.notes} onChange={event => setValues({ ...values, notes: event.target.value })} /></FormField>
        {id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={values.archived} onChange={event => setValues({ ...values, archived: event.target.checked })} />Archived — keep relationships and stop new links</label>}
      </fieldset>
      {account && !canEdit && <p className="text-sm text-muted-foreground">You can view this account through a contact. Ask its owner or a manager to edit it.</p>}
    </form>
    {account && <><p className="text-sm text-muted-foreground">Link or unlink accounts from a <Link className="underline" href="/crm/contacts">contact’s page</Link>. Only contacts you can access appear here.</p><RecordList kind="contacts" accountId={account.id} /></>}
    <Dialog open={confirmArchive} onOpenChange={open => { if (!saving) setConfirmArchive(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this account?</DialogTitle><DialogDescription>Existing contact relationships will be kept. New relationships cannot be added until the account is restored.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirmArchive(false)}>Cancel</Button><Button loading={saving} onClick={() => void persist()}>Archive account</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
