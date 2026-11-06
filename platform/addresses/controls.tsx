"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { EditPanel, ReadOnlyFields, RecordPanel } from "@/components/erp/record-detail"
import { Section } from "@/components/erp/section"
import { ReloadDraft } from "@/components/erp/reload-draft"
import { emptyCorrespondence, informationFields, informationLabels } from "@/platform/participants/information"
import { AddressFields } from "./fields"
import { addressFieldsSchema, addressPurposes, addressPurposeLabels, type AddressFields as Fields, type AddressPurpose, type AddressRow } from "./contracts"

type Page = { items: AddressRow[]; totalPages: number; canCreate: boolean; canEdit: boolean; canArchive: boolean }
type Detail = AddressRow & Pick<Page, "canEdit" | "canArchive">
const flags = { CORRESPONDENCE: "defaultCorrespondence", BILLING: "defaultBilling", DELIVERY: "defaultDelivery" } as const
const initial = (): Fields => ({ name: "", purposes: ["CORRESPONDENCE"], values: { ...emptyCorrespondence }, defaultCorrespondence: false, defaultBilling: false, defaultDelivery: false, archived: false })
function fields(row: AddressRow): Fields { return { name: row.name, purposes: row.purposes, values: row.values, defaultCorrespondence: row.defaultCorrespondence, defaultBilling: row.defaultBilling, defaultDelivery: row.defaultDelivery, archived: row.archived } }
const summary = (row: AddressRow) => [row.values.addressLine1, row.values.addressLine2, row.values.city, row.values.region, row.values.postalCode, row.values.country].filter(Boolean).join(", ")
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load or save the address.")
  return data
}

export function PartyAddresses({ endpoint }: { endpoint: string }) {
  const [data, setData] = React.useState<Page>(), [page, setPage] = React.useState(1), [status, setStatus] = React.useState("active"), [reload, setReload] = React.useState(0)
  const [error, setError] = React.useState(""), [detail, setDetail] = React.useState<Detail>(), [open, setOpen] = React.useState(false), [loading, setLoading] = React.useState(false)
  const [draft, setDraft] = React.useState(initial), [baseline, setBaseline] = React.useState(""), [saving, setSaving] = React.useState(false), [draftError, setDraftError] = React.useState("")
  const token = React.useRef(0)
  React.useEffect(() => {
    const controller = new AbortController(); setData(undefined); setError("")
    fetch(`${endpoint}?page=${page}&status=${status}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const next = await response.json(); if (!response.ok) throw new Error(next.error || "Unable to load addresses."); if (!controller.signal.aborted) setData(next)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [endpoint, page, status, reload])
  React.useEffect(() => { token.current++; setOpen(false); setLoading(false) }, [endpoint])
  async function inspect(id: string) {
    const current = ++token.current; setLoading(true); setError("")
    try { const next = await api<Detail>(`${endpoint}/${id}`); if (current !== token.current) return; setDetail(next); const value = fields(next); setDraft(value); setBaseline(JSON.stringify(value)); setDraftError(""); setOpen(true) }
    catch (e) { if (current === token.current) setError((e as Error).message) } finally { if (current === token.current) setLoading(false) }
  }
  function create() { setDetail(undefined); const value = initial(); setDraft(value); setBaseline(JSON.stringify(value)); setDraftError(""); setOpen(true) }
  async function save(event: React.FormEvent) {
    event.preventDefault(); event.stopPropagation(); if (saving) return
    const parsed = addressFieldsSchema.safeParse(draft)
    if (!parsed.success) { setDraftError(parsed.error.issues.map(item => item.message).join(" ")); return }
    setSaving(true); setDraftError("")
    try { await api(endpoint + (detail ? `/${detail.id}` : ""), detail ? "PATCH" : "POST", { ...parsed.data, ...(detail ? { version: detail.version } : {}) }); setOpen(false); setReload(v => v + 1) }
    catch (e) { setDraftError((e as Error).message) } finally { setSaving(false) }
  }
  function purpose(p: AddressPurpose, enabled: boolean) { setDraft(row => ({ ...row, purposes: enabled ? [...row.purposes, p] : row.purposes.filter(item => item !== p), ...(!enabled ? { [flags[p]]: false } : {}) })) }
  const canEdit = detail ? detail.canEdit : data?.canCreate
  return <Section title="Address book" description="Named addresses and defaults for future transactions. Saved transaction details and issued documents keep their accepted copies." actions={data?.canCreate && <Button type="button" onClick={create}>Add address</Button>}>
    <div className="flex flex-wrap items-center gap-3"><Select aria-label="Address status" value={status} onValueChange={value => { setStatus(value); setPage(1) }}><option value="active">Active addresses</option><option value="archived">Archived addresses</option><option value="all">All addresses</option></Select><Button type="button" variant="outline" onClick={() => setReload(v => v + 1)}>Refresh addresses</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{(!data || loading) && !error && <p role="status">Loading addresses...</p>}
    {data && <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Address</th><th className="p-3">Purpose / defaults</th><th className="p-3">Actions</th></tr></thead><tbody>{data.items.map(row => <tr className="border-b" key={row.id}><td className="max-w-sm p-3"><p className="font-medium">{row.name}{row.archived && " (archived)"}</p><p className="mt-1 break-words text-muted-foreground">{summary(row)}</p></td><td className="p-3">{row.purposes.map(p => <p key={p}>{addressPurposeLabels[p]}{row[flags[p]] && " · Default"}</p>)}</td><td className="p-3"><Button type="button" variant="outline" disabled={loading} onClick={() => void inspect(row.id)}>View address</Button></td></tr>)}</tbody></table>{!data.items.length && <p className="p-3 text-sm text-muted-foreground">No saved addresses in this view.</p>}</div><div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Previous addresses</Button><span className="text-sm">Page {page} of {data.totalPages}</span><Button type="button" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage(v => v + 1)}>Next addresses</Button></div></>}
    {open && !canEdit && detail ? <RecordPanel title={detail.name} description="Saved address details." onClose={() => setOpen(false)}><ReadOnlyFields fields={informationFields.map(field => ({ label: informationLabels[field], value: detail.values[field] }))} /></RecordPanel> : open && <EditPanel open title={detail ? "Edit address" : "Add address"} description="Defaults are copied into new transactions. Existing transaction copies stay unchanged." saving={saving} dirty={baseline !== JSON.stringify(draft)} onClose={() => setOpen(false)} onSubmit={save} error={draftError} disabled={!canEdit || baseline === JSON.stringify(draft)} saveLabel="Save address" footerActions={detail && <ReloadDraft disabled={saving} onReload={() => void inspect(detail.id)} />}>
      <FormField id="address-name" label="Address name"><Input id="address-name" required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Home, registered office, project site..." /></FormField>
      <fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium">Address purposes</legend>{addressPurposes.map(p => <div key={p} className="flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.purposes.includes(p)} onChange={e => purpose(p, e.target.checked)} />{addressPurposeLabels[p]}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Default ${addressPurposeLabels[p]}`} disabled={draft.archived || !draft.purposes.includes(p)} checked={draft[flags[p]]} onChange={e => setDraft({ ...draft, [flags[p]]: e.target.checked })} />Default</label></div>)}</fieldset>
      <AddressFields id="address-book" values={draft.values} onChange={(field, value) => setDraft({ ...draft, values: { ...draft.values, [field]: value } })} />
      {detail && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.archived} disabled={!detail.canArchive} onChange={e => setDraft({ ...draft, archived: e.target.checked, ...(e.target.checked ? { defaultCorrespondence: false, defaultBilling: false, defaultDelivery: false } : {}) })} />Archived</label>}
    </EditPanel>}
  </Section>
}

// The picker fetches only when explicitly opened. Source adapters provide an
// authorized owner endpoint; selecting never writes the directory or the source.
export function SavedAddressPicker({ endpoint, purpose, onSelect }: { endpoint: string; purpose: AddressPurpose; onSelect: (row: AddressRow) => void }) {
  const [open, setOpen] = React.useState(false), [q, setQ] = React.useState(""), [page, setPage] = React.useState(1), [data, setData] = React.useState<Page>(), [error, setError] = React.useState(""), [loading, setLoading] = React.useState(false)
  const selection = React.useRef(0)
  React.useEffect(() => () => { selection.current++ }, [endpoint, purpose])
  function close() { selection.current++; setOpen(false); setLoading(false) }
  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController(); setData(undefined); setError("")
    const timer = setTimeout(() => { void fetch(`${endpoint}?${new URLSearchParams({ purpose, page: String(page), q })}`, { cache: "no-store", signal: controller.signal }).then(async response => { const next = await response.json(); if (!response.ok) throw new Error(next.error || "Unable to load addresses."); if (!controller.signal.aborted) setData(next) }).catch(e => { if (!controller.signal.aborted) setError(e.message) }) }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, endpoint, purpose, page, q])
  return <><Button type="button" variant="outline" onClick={() => { setOpen(true); setQ(""); setPage(1) }}>Choose saved address</Button>{open && <RecordPanel title={`Choose ${addressPurposeLabels[purpose].toLowerCase()} address`} description="Copies the selected version into this transaction. Review the details before saving." onClose={close}>
    <Input aria-label="Find saved address" placeholder="Search address names..." maxLength={100} value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{!data && !error && <p>Loading addresses...</p>}
    {data?.items.map(row => <div key={row.id} className="space-y-2 rounded-md border p-3"><p className="font-medium">{row.name}</p><p className="break-words text-sm text-muted-foreground">{summary(row)}</p><Button type="button" variant="outline" disabled={loading} onClick={async () => { const token = ++selection.current; setLoading(true); setError(""); try { const selected = await api<AddressRow>(`${endpoint}/${row.id}`); if (token !== selection.current) return; if (selected.archived || !selected.purposes.includes(purpose)) throw new Error("This address is no longer available. Choose another address."); onSelect(selected); close() } catch (e) { if (token === selection.current) setError((e as Error).message) } finally { if (token === selection.current) setLoading(false) } }}>Use {row.name}</Button></div>)}
    {data && !data.items.length && <p className="text-sm">No active addresses for this purpose. Add one on the contact or business account, or enter transaction details manually.</p>}
    {data && <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>Previous addresses</Button><span className="text-sm">{page} / {data.totalPages}</span><Button type="button" variant="outline" disabled={page >= data.totalPages || loading} onClick={() => setPage(v => v + 1)}>Next addresses</Button></div>}
  </RecordPanel>}</>
}
