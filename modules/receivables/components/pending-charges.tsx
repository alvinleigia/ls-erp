"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/erp/controls"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { formatDecimalCurrency } from "@/lib/formatting"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import type { PendingReceivableCharge } from "../contracts"

export type ChargeConfirmation = { id: string; sourceKey: string; label: string; amount: string; dueOn: string | null; reason: string; actorName: string; createdAt: string }
export function PendingCharges({ orderId, pending = [], confirmations = [], version, canConfirm, currency, onSaved }: {
  orderId: string; pending?: PendingReceivableCharge[]; confirmations?: ChargeConfirmation[]; version?: number; canConfirm: boolean; currency: string; onSaved: () => Promise<void>
}) {
  const [selected, setSelected] = useState<PendingReceivableCharge>(), [amount, setAmount] = useState(""), [dueOn, setDueOn] = useState(""), [reason, setReason] = useState(""), [requestKey, setRequestKey] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("")
  const { formatDateTime, formatDateOnly } = useDateFormatter(), money = (n: string) => formatDecimalCurrency(n, currency)
  if (!pending.length) return null
  const remaining = pending.filter(row => !confirmations.some(c => c.sourceKey === row.sourceKey))
  async function save() {
    if (!selected || !version) return
    setBusy(true); setError("")
    try {
      const response = await fetch(`/api/sales-orders/${orderId}/receivables/charges`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceKey: selected.sourceKey, requestKey, version, amount: amount.trim(), dueOn: dueOn || null, reason: reason.trim() }) })
      const result = await response.json()
      if (!response.ok) throw Error(result.error || "Unable to confirm this charge.")
      await onSaved(); setSelected(undefined)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="space-y-3 rounded-lg border p-4" aria-label="Unpriced extras">
    <h3 className="font-medium">Charges to be confirmed{remaining.length ? ` (${remaining.length})` : " — all confirmed"}</h3>
    {remaining.length > 0 && <p className="text-sm text-muted-foreground">These extras are excluded from the known total and outstanding balance until confirmed. Known instalments can still be collected.</p>}
    {pending.map(charge => {
      const saved = confirmations.find(row => row.sourceKey === charge.sourceKey)
      return <div key={charge.sourceKey} className="flex flex-wrap items-start justify-between gap-3 border-t pt-3">
        <div className="min-w-0 break-words"><p className="font-medium">{charge.label}</p>{saved ? <><p>{money(saved.amount)}{saved.amount && Number(saved.amount) === 0 ? " — no charge due" : ""}{saved.dueOn ? ` · Due ${formatDateOnly(saved.dueOn.slice(0, 10))}` : ""}</p><p className="text-sm text-muted-foreground">Confirmed by {saved.actorName} · {formatDateTime(saved.createdAt)}</p><p className="whitespace-pre-wrap text-sm">{saved.reason}</p></> : <><p className="text-sm">Amount to be confirmed</p>{charge.conditions && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{charge.conditions}</p>}</>}</div>
        {!saved && canConfirm && <Button variant="outline" aria-label={`Confirm amount for ${charge.label}`} onClick={() => { setSelected(charge); setAmount(""); setDueOn(""); setReason(""); setRequestKey(crypto.randomUUID()); setError("") }}>Confirm amount</Button>}
      </div>
    })}
    {!version && remaining.length > 0 && <p className="text-sm text-muted-foreground">Open receivables for the known amounts before confirming these extras.</p>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !busy) setSelected(undefined) }}><DialogContent><DialogHeader><DialogTitle>Confirm {selected?.label}</DialogTitle><DialogDescription>This permanently records the agreed extra and adds it to the payment schedule. It does not change the original price or instalments. Enter zero only when no charge is due.</DialogDescription></DialogHeader>
      <FormField id="charge-confirm-amount" label={`Confirmed amount (${currency})`}><Input id="charge-confirm-amount" inputMode="decimal" disabled={busy} value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
      <FormField id="charge-confirm-due" label="Due date (optional)"><Input id="charge-confirm-due" type="date" disabled={busy} value={dueOn} onChange={e => setDueOn(e.target.value)} /></FormField>
      <FormField id="charge-confirm-reason" label="Confirmation reason / customer agreement reference"><Textarea id="charge-confirm-reason" maxLength={2000} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></FormField>
      {error && <p role="alert" className="text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelected(undefined)}>Go back</Button><Button loading={busy} disabled={!amount.trim() || !reason.trim()} onClick={save}>Confirm charge</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}
