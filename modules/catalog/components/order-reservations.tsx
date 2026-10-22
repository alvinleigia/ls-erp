"use client"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { Section } from "@/components/erp/section"
import { Pagination } from "@/components/erp/pagination"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useDateFormatter } from "@/hooks/use-date-formatter"
type Reservation = { id: string; itemCode: string; itemName: string; status: string; version: number; expiresAt: string; events: { version: number; status: string; actorName: string; createdAt: string; reason: string }[] }
type Result = { items: Reservation[]; units: { itemId: string; code: string; name: string; available: boolean }[]; canCreate: boolean; canAllocate: boolean; canRelease: boolean; total: number; page: number; pageSize: number }
const labels: Record<string, string> = { HELD: "Reserved", ALLOCATED: "Allocated", RELEASED: "Released", EXPIRED: "Expired" }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), result = await response.json()
  if (!response.ok) throw Error(result.error || "Unable to update reservations.")
  return result
}
export function OrderReservations({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Result>(), [page, setPage] = useState(1), [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const [action, setAction] = useState<{ kind: "reserve" | "allocate" | "release"; id: string; name: string; version?: number } | null>(null)
  const [expiry, setExpiry] = useState(""), [reason, setReason] = useState("")
  const { formatDateTime } = useDateFormatter(), endpoint = `/api/sales-orders/${orderId}/reservations`
  const load = useCallback(async (signal?: AbortSignal) => { const next = await request<Result>(`${endpoint}?page=${page}`, { signal }); setData(next) }, [endpoint, page])
  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => load(controller.signal).catch(e => { if (!controller.signal.aborted) { setData(undefined); setError(e.message) } })
    refresh(); const timer = setInterval(refresh, 30000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [load])
  const open = (next: NonNullable<typeof action>) => {
    const tomorrow = new Date(Date.now() + 86400000)
    setExpiry(new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
    setReason(""); setError(""); setAction(next)
  }
  async function save() {
    if (!action) return
    if (action.kind === "reserve" && (!expiry || !Number.isFinite(new Date(expiry).getTime()))) { setError("Choose a valid expiry."); return }
    setBusy(true); setError("")
    try {
      await request(action.kind === "reserve" ? endpoint : `${endpoint}/${action.id}`, { method: action.kind === "reserve" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action.kind === "reserve" ? { itemId: action.id, expiresAt: new Date(expiry).toISOString() } : { action: action.kind, version: action.version, ...(action.kind === "release" ? { reason } : {}) }) })
      setAction(null); await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Section title="Unit reservations"><div className="space-y-4">
    <p className="text-sm text-muted-foreground">Reserve unique units from this order’s saved quotation. Holds expire automatically. Allocation requires a confirmed order and keeps the unit unavailable until explicitly released or the order is cancelled. No payment or stock movement is recorded.</p>
    <Button variant="outline" disabled={busy} onClick={() => { setError(""); load().catch(e => { setData(undefined); setError(e.message) }) }}>Refresh reservations</Button>
    {error && !action && <p role="alert" className="text-destructive">{error}</p>}
    {data && <>
      {data.canCreate && data.units.some(unit => unit.available) && <div className="space-y-2">{data.units.filter(unit => unit.available).map(unit => <div key={unit.itemId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><span className="min-w-0 break-words">{unit.code} · {unit.name}</span><Button variant="outline" onClick={() => open({ kind: "reserve", id: unit.itemId, name: unit.name })}>Reserve unit</Button></div>)}</div>}
      {!data.units.length && <p className="text-sm text-muted-foreground">No accessible unique catalog units in this saved quotation. Product quantities and manual lines cannot be reserved here.</p>}
      {!data.items.length && <p>No reservations for this order.</p>}
      {data.items.map(row => <article key={row.id} className="space-y-3 rounded-lg border p-4" aria-label={`Reservation ${row.itemCode}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{row.itemCode} · {row.itemName}</p><p>{labels[row.status]}</p><p className="text-sm text-muted-foreground">{row.status === "ALLOCATED" ? "Original hold expiry" : "Hold expiry"}: {formatDateTime(row.expiresAt)}</p></div><div className="flex flex-wrap gap-2">{row.status === "HELD" && data.canAllocate && <Button onClick={() => open({ kind: "allocate", id: row.id, name: row.itemName, version: row.version })}>Allocate unit</Button>}{["HELD", "ALLOCATED"].includes(row.status) && data.canRelease && <Button variant="outline" onClick={() => open({ kind: "release", id: row.id, name: row.itemName, version: row.version })}>Release unit</Button>}</div></div><details><summary className="cursor-pointer text-sm">Reservation history</summary><ol className="mt-3 space-y-2 text-sm">{row.events.map(event => <li key={event.version} className="break-words">{labels[event.status]} · {event.actorName} · {formatDateTime(event.createdAt)}{event.reason && <p className="whitespace-pre-wrap text-muted-foreground">{event.reason}</p>}</li>)}{row.status === "EXPIRED" && row.events.at(-1)?.status === "HELD" && <li>Expired automatically at {formatDateTime(row.expiresAt)}.</li>}</ol></details></article>)}
      <Pagination {...data} onPageChange={setPage} label="Reservations pagination" />
    </>}
    <Dialog open={!!action} onOpenChange={value => { if (!value && !busy) { setAction(null); setError("") } }}><DialogContent><DialogHeader><DialogTitle>{action?.kind === "reserve" ? "Reserve unit" : action?.kind === "allocate" ? "Allocate unit" : "Release unit"}</DialogTitle><DialogDescription>{action?.name}. {action?.kind === "reserve" ? "Choose a future expiry within 30 days. To extend a hold, release it and reserve again." : action?.kind === "allocate" ? "Keep this unit assigned to the confirmed order without an expiry. This does not record a payment or legal transfer." : "Make this unit available again. The reservation and its history will be retained."}</DialogDescription></DialogHeader>
      {action?.kind === "reserve" && <FormField id="reservation-expiry" label="Expiry (your device time)"><Input id="reservation-expiry" type="datetime-local" required disabled={busy} value={expiry} onChange={e => setExpiry(e.target.value)} /></FormField>}
      {action?.kind === "release" && <FormField id="reservation-reason" label="Release reason"><Textarea id="reservation-reason" required maxLength={2000} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></FormField>}
      {error && <p role="alert" className="text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setAction(null); setError("") }}>Go back</Button><Button loading={busy} disabled={action?.kind === "release" ? !reason.trim() : action?.kind === "reserve" && !expiry} onClick={save}>{action?.kind === "reserve" ? "Save reservation" : action?.kind === "allocate" ? "Confirm allocation" : "Confirm release"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div></Section>
}
