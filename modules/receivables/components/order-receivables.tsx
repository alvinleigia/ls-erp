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
import { formatDecimalCurrency } from "@/lib/formatting"
type Line = { id: string; label: string; amount: string; dueOn: string | null; paid: string; outstanding: string }
type Payment = { id: string; amount: string; receivedOn: string; method: string; reference: string; note: string; status: string; actorName: string; createdAt: string; reversal: { kind: string; reason: string; reference: string; effectiveOn: string; actorName: string } | null }
type Result = { account: { total: string; version: number } | null; currency: string; status: string; today: string; plan: { blocked: string | null; total: string; lines: { label: string; amount: string; dueOn: string | null }[] }; lines: Line[]; paid: string; outstanding: string; overdue: string; items: Payment[]; total: number; page: number; pageSize: number; canOpen: boolean; canRecord: boolean; canReverse: boolean; canReadPayments: boolean }
const methods = { BANK_TRANSFER: "Bank transfer", UPI: "UPI", CARD: "Card", CASH: "Cash", CHEQUE: "Cheque", OTHER: "Other" }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init }), result = await response.json()
  if (!response.ok) throw Error(result.error || "Unable to update receivables.")
  return result
}
export function OrderReceivables({ orderId }: { orderId: string }) {
  const endpoint = `/api/sales-orders/${orderId}/receivables`, { formatDateOnly, formatDateTime } = useDateFormatter()
  const [data, setData] = useState<Result>(), [page, setPage] = useState(1), [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const [action, setAction] = useState<{ kind: "open" | "record" | "reverse"; payment?: Payment; key: string; version: number } | null>(null)
  const [dates, setDates] = useState<string[]>([]), [amount, setAmount] = useState(""), [effective, setEffective] = useState(""), [method, setMethod] = useState("BANK_TRANSFER"), [reference, setReference] = useState(""), [note, setNote] = useState(""), [reversal, setReversal] = useState("CORRECTION")
  const load = useCallback(async (signal?: AbortSignal) => { setData(await request<Result>(`${endpoint}?page=${page}`, { signal })) }, [endpoint, page])
  useEffect(() => { const c = new AbortController(); load(c.signal).catch(e => { if (!c.signal.aborted) { setData(undefined); setError(e.message) } }); return () => c.abort() }, [load])
  const money = (value: string) => formatDecimalCurrency(value, data?.currency || "INR")
  function open(kind: "open" | "record" | "reverse", payment?: Payment) {
    if (!data) return
    setAction({ kind, payment, key: crypto.randomUUID(), version: data.account?.version || 1 }); setDates(data.plan.lines.map(l => l.dueOn || "")); setAmount(""); setEffective(data.today); setReference(""); setNote(""); setMethod("BANK_TRANSFER"); setReversal("CORRECTION"); setError("")
  }
  async function save() {
    if (!action) return
    setBusy(true); setError("")
    const body = action.kind === "open" ? { dueDates: dates.map(d => d || null) } : action.kind === "record" ? { requestKey: action.key, version: action.version, amount, receivedOn: effective, method, reference, note } : { requestKey: action.key, version: action.version, kind: reversal, reason: note, effectiveOn: effective, reference }
    try {
      await request(action.kind === "open" ? endpoint : action.kind === "record" ? `${endpoint}/payments` : `${endpoint}/payments/${action.payment!.id}/reverse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      setAction(null); await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Section title="Receivables"><div className="space-y-4">
    <p className="text-sm text-muted-foreground">Track amounts owed against the saved order. Record payments received elsewhere; this does not collect money or issue a tax invoice.</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setError(""); load().catch(e => { setData(undefined); setError(e.message) }) }}>Refresh receivables</Button>{data?.canOpen && <Button onClick={() => open("open")}>Open receivables</Button>}{data?.canRecord && <Button onClick={() => open("record")}>Record payment</Button>}</div>
    {error && !action && <p role="alert" className="text-destructive">{error}</p>}
    {data && <>
      {!data.account && <p>{data.plan.blocked || (data.status === "CONFIRMED" ? "Receivables have not been opened. Review the schedule and dates before opening." : "Confirm this order to open receivables.")}</p>}
      {data.account && <>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 lg:grid-cols-4">{[["Order total", data.account.total], ["Net received", data.paid], ["Outstanding", data.outstanding], ["Overdue", data.overdue]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="break-words text-lg font-semibold">{money(value)}</dd></div>)}</dl>
        {data.status === "CANCELLED" && <p>Order cancelled. The schedule and payment history are retained; no balance is due.</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-3 text-left font-medium">Payment schedule</caption><thead><tr>{["Description", "Due date", "Amount", "Received", "Balance"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{data.lines.map(l => <tr key={l.id} className="border-t"><td className="min-w-32 p-2">{l.label}</td><td className="whitespace-nowrap p-2">{l.dueOn ? formatDateOnly(l.dueOn.slice(0, 10)) : "Unscheduled"}</td><td className="whitespace-nowrap p-2">{money(l.amount)}</td><td className="whitespace-nowrap p-2">{money(l.paid)}</td><td className="whitespace-nowrap p-2">{data.status === "CANCELLED" ? "Cancelled" : money(l.outstanding)}</td></tr>)}</tbody></table></div>
        <p className="text-xs text-muted-foreground">Payments cover the earliest due balance first; unscheduled amounts follow. Blank due dates are excluded from overdue totals.</p>
        {data.canReadPayments && <div className="space-y-3"><h3 className="font-medium">Payment history</h3>{!data.items.length && <p>No payments recorded.</p>}{data.items.map(p => <article key={p.id} className="space-y-2 rounded-lg border p-4" aria-label={`Payment ${p.reference || p.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 break-words"><p className="font-medium">{money(p.amount)} · {methods[p.method as keyof typeof methods]}</p><p>{formatDateOnly(p.receivedOn.slice(0, 10))} · {p.reference || "No reference"}</p><p className="text-sm text-muted-foreground">Recorded by {p.actorName} · {formatDateTime(p.createdAt)}</p></div>{p.status === "POSTED" && data.canReverse && <Button variant="outline" onClick={() => open("reverse", p)}>Correct or refund</Button>}</div>{p.note && <p className="whitespace-pre-wrap break-words text-sm">{p.note}</p>}{p.reversal && <p className="break-words text-sm">{p.reversal.kind === "REFUND" ? "Full refund recorded" : "Entry corrected"} · {formatDateOnly(p.reversal.effectiveOn.slice(0, 10))} · {p.reversal.actorName}<br />{p.reversal.reason}{p.reversal.reference && ` · ${p.reversal.reference}`}</p>}</article>)}<Pagination {...data} onPageChange={setPage} label="Payments pagination" /></div>}
      </>}
    </>}
    <Dialog open={!!action} onOpenChange={value => { if (!value && !busy) { setAction(null); setError("") } }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{action?.kind === "open" ? "Open receivables" : action?.kind === "record" ? "Record payment" : "Correct or refund payment"}</DialogTitle><DialogDescription>{action?.kind === "open" ? "Amounts come from the saved quotation, including known extra charges. These dates will be frozen. Leave unknown dates blank." : action?.kind === "record" ? "Enter a payment already received in the order currency. Partial payments are supported." : "Correct a mistaken entry, or record a full refund already paid externally. The original entry remains in history."}</DialogDescription></DialogHeader>
      {action?.kind === "open" ? <div className="space-y-4">{data?.plan.lines.map((l, i) => <FormField key={i} id={`receivable-due-${i}`} label={`${l.label} · ${money(l.amount)}`}><Input type="date" id={`receivable-due-${i}`} disabled={busy} value={dates[i] || ""} onChange={e => setDates(previous => previous.map((d, n) => n === i ? e.target.value : d))} /></FormField>)}</div> : <>
        {action?.kind === "record" ? <><FormField id="payment-amount" label={`Amount (${data?.currency})`}><Input id="payment-amount" inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /></FormField><FormField id="payment-method" label="Payment method"><select id="payment-method" className="h-10 w-full rounded-md border bg-background px-3" value={method} disabled={busy} onChange={e => setMethod(e.target.value)}>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField></> : <><p className="font-medium">Full amount: {action?.payment && money(action.payment.amount)}</p><FormField id="payment-reversal" label="Reversal type"><select id="payment-reversal" className="h-10 w-full rounded-md border bg-background px-3" value={reversal} disabled={busy} onChange={e => setReversal(e.target.value)}><option value="CORRECTION">Correct a mistaken entry</option><option value="REFUND">Record a full refund</option></select></FormField></>}
        <FormField id="payment-date" label={action?.kind === "record" ? "Payment date" : "Effective date"}><Input id="payment-date" type="date" max={data?.today} value={effective} disabled={busy} onChange={e => setEffective(e.target.value)} /></FormField>
        <FormField id="payment-reference" label={action?.kind === "record" ? `Payment reference${method === "CASH" ? " (optional)" : ""}` : reversal === "CORRECTION" ? "Correction reference (optional)" : "Refund reference"}><Input id="payment-reference" maxLength={120} value={reference} disabled={busy} onChange={e => setReference(e.target.value)} /></FormField>
        <FormField id="payment-note" label={action?.kind === "record" ? "Note (optional)" : "Reason"}><Textarea id="payment-note" maxLength={2000} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></FormField>
      </>}
      {error && <p role="alert" className="text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => { setAction(null); setError("") }}>Go back</Button><Button loading={busy} onClick={save} disabled={action?.kind !== "open" && (!effective || (action?.kind === "record" ? !amount || (method !== "CASH" && !reference.trim()) : !note.trim() || (reversal === "REFUND" && !reference.trim())))}>{action?.kind === "open" ? "Confirm schedule" : action?.kind === "record" ? "Save payment" : "Confirm reversal"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div></Section>
}
