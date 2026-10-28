"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useBusinessModules } from "@/platform/module-provider"
import { useTerminology } from "@/platform/terminology/provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { formatDecimalCurrency } from "@/lib/formatting"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { orderRequest } from "./request"
type Review = { quotationId: string; revision: number; title: string; customerName: string; consideration: string; currency: string; orderedOn: string; existing: { id: string; reference: string | null; revision: number; orderedOn: string | null } | null }
export function CreateSalesOrder({ quotationId, revision, disabled }: { quotationId: string; revision: number; disabled: boolean }) {
  const modules = useBusinessModules(), term = useTerminology(), router = useRouter(), { formatDateOnly } = useDateFormatter()
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [open, setOpen] = useState(false), [review, setReview] = useState<Review>(), [orderedOn, setOrderedOn] = useState("")
  if (!modules.enabled("salesOrders") || !modules.can(["salesOrders.read", "salesOrders.create", "quotations.read"])) return null
  const label = term("salesOrders.order.singular", "sales order")
  async function prepare() {
    setOpen(true); setBusy(true); setError(""); setReview(undefined)
    try {
      const data = await orderRequest<Review>(`/api/sales-orders/context?${new URLSearchParams({ quotationId, revision: String(revision) })}`)
      setReview(data); setOrderedOn(data.orderedOn)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function create() {
    if (!review) return
    setBusy(true); setError("")
    try {
      const row = await orderRequest<{ id: string }>("/api/sales-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotationId: review.quotationId, revision: review.revision, orderedOn }) })
      router.push(`/sales-orders/${row.id}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <><Button type="button" variant="outline" disabled={disabled} loading={busy} onClick={prepare}>{term("salesOrders.order.singular", "Create sales order", "Create {label}")}</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}><DialogContent><form className="space-y-4" onSubmit={e => { e.preventDefault(); void create() }}><DialogHeader><DialogTitle>Review {label}</DialogTitle><DialogDescription>Use this saved quotation revision to create a draft agreement. Customer requirements are checked again at confirmation. Unit holds, allocation and payments remain separate actions.</DialogDescription></DialogHeader>
      {review && <><ReadOnlyFields fields={[{ label: "Quotation", value: `${review.title} - revision ${review.revision}` }, { label: "Customer", value: review.customerName }, { label: "Consideration", value: formatDecimalCurrency(review.consideration, review.currency) }]} />
        {review.existing ? <p>An active {label} already uses revision {review.existing.revision}: {review.existing.reference || "reference not recorded"}. {term("salesOrders.order.singular", "Order date", "{label} date")}: {formatDateOnly(review.existing.orderedOn)}. Open it to review, or cancel it before creating a replacement.</p> : <><FormField id="order-date" label={term("salesOrders.order.singular", "Order date", "{label} date")}><Input id="order-date" type="date" required min="0001-01-01" max={review.orderedOn} value={orderedOn} disabled={busy} onChange={e => { setOrderedOn(e.target.value); setError("") }} /></FormField><p className="text-sm text-muted-foreground">Defaults to today in the tenant time zone. The date and generated reference are fixed when the draft is saved.</p></>}
      </>}
      {busy && !review && <p role="status">Loading saved terms...</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Go back</Button>{review?.existing ? <Button type="button" onClick={() => router.push(`/sales-orders/${review.existing!.id}`)}>Open existing order</Button> : <Button type="submit" loading={busy} disabled={!review || !orderedOn}>Create draft</Button>}</DialogFooter>
    </form></DialogContent></Dialog>
  </>
}
