"use client"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/erp/controls"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Section } from "@/components/erp/section"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import { pageClass } from "@/components/erp/page"
import { AccessPageHeader } from "@/platform/access/record-page"
import { withRecordView, useRecordView } from "@/platform/access/record-view"
import type { RecordAccess } from "@/platform/access/record-actions"
import Link from "@/platform/access/link"
import { useTerminology } from "@/platform/terminology/provider"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import { orderRequest } from "./request"
import { orderStatus, type OrderRow } from "./list"
type OrderDetail = OrderRow & { recordAccess: RecordAccess; snapshot: unknown; canConfirm: boolean; canCancel: boolean; history: { version: number; status: string; actorName: string; reason: string; createdAt: string }[] }
export const OrderDetail = withRecordView(OrderDetailBody)
function OrderDetailBody({ id, renderSnapshot, renderRelated }: { id: string; renderSnapshot: (snapshot: unknown) => ReactNode; renderRelated?: (version: number) => ReactNode }) {
  const { loadAccess } = useRecordView()!
  const term = useTerminology(), { formatDateTime } = useDateFormatter()
  const [row, setRow] = useState<OrderDetail>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [action, setAction] = useState<"confirm" | "cancel" | null>(null), [reason, setReason] = useState("")
  const load = useCallback(async (signal?: AbortSignal) => { const data = await orderRequest<OrderDetail>(`/api/sales-orders/${id}`, { signal }); loadAccess(data.recordAccess); setRow(data) }, [id, loadAccess])
  useEffect(() => { const c = new AbortController(); load(c.signal).catch(e => { if (!c.signal.aborted) setError(e.message) }); return () => c.abort() }, [load])
  async function transition() {
    if (!row || !action) return
    setBusy(true); setError("")
    try {
      await orderRequest(`/api/sales-orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: row.version, ...(action === "cancel" ? { reason } : {}) }) })
      setAction(null); setReason(""); await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const label = term("salesOrders.order.singular", "sales order")
  return <div className={pageClass}><AccessPageHeader title={row?.title || label} backHref="/sales-orders" badge={row && <span className="rounded bg-muted px-2 py-1 text-sm">{orderStatus(row.status)}</span>} actions={row && <><Button variant="outline" disabled={busy} onClick={() => { setError(""); load().catch(e => setError(e.message)) }}>Refresh</Button>{row.canConfirm && <Button onClick={() => { setError(""); setAction("confirm") }}>Confirm {label}</Button>}{row.canCancel && <Button variant="outline" onClick={() => { setError(""); setAction("cancel") }}>Cancel {label}</Button>}</>} />
    {error && !action && <p role="alert" className="text-destructive">{error}</p>}
    {!row && !error && <p>Loading order...</p>}
    {row && <><Section title="Agreement"><ReadOnlyFields fields={[{ label: "Reference", value: row.id }, { label: "Customer", value: row.customerName }, { label: "Consideration", value: formatDecimalCurrency(row.consideration, row.currency) }, { label: "Created", value: formatDateTime(row.createdAt) }, { label: "Source", value: <Link className="underline" href={`/crm/quotations/${row.quotationId}?revision=${row.revision}`}>Quotation revision {row.revision}</Link> }]} /><p className="mt-4 text-sm text-muted-foreground">These terms are fixed to the saved quotation revision. To change them, cancel this order and create a replacement from a corrected quotation.</p></Section>
      {renderRelated?.(row.version)}
      {renderSnapshot(row.snapshot)}
      <Section title="History"><ol className="space-y-4">{row.history.map(event => <li key={event.version} className="rounded-lg border p-4"><p className="font-medium">{orderStatus(event.status)} · {event.actorName}</p><p className="text-sm text-muted-foreground">{formatDateTime(event.createdAt)}</p>{event.reason && <p className="mt-2 whitespace-pre-wrap break-words">{event.reason}</p>}</li>)}</ol></Section></>}
    <Dialog open={!!action} onOpenChange={open => { if (!open && !busy) { setAction(null); setError("") } }}><DialogContent><DialogHeader><DialogTitle>{action === "confirm" ? `Confirm ${label}?` : `Cancel ${label}?`}</DialogTitle><DialogDescription>{action === "confirm" ? "Confirm that the customer has agreed to these terms. This records the agreement; it does not reserve stock or property, collect payments, or close the opportunity." : "Cancellation is permanent and releases any unit reservations or allocations. The order and its history will be retained. You can create a replacement from a saved quotation."}</DialogDescription></DialogHeader>
      {action === "cancel" && <div className="space-y-2"><label htmlFor="order-cancel-reason" className="text-sm font-medium">Cancellation reason</label><Textarea id="order-cancel-reason" maxLength={2000} required value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setAction(null); setError("") }}>Go back</Button><Button variant={action === "cancel" ? "destructive" : "default"} loading={busy} disabled={action === "cancel" && !reason.trim()} onClick={transition}>{action === "confirm" ? "Confirm agreement" : "Cancel order"}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
