"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useBusinessModules } from "@/platform/module-provider"
import { useTerminology } from "@/platform/terminology/provider"
import { Button } from "@/components/ui/button"
import { orderRequest } from "./request"
export function CreateSalesOrder({ quotationId, revision, disabled }: { quotationId: string; revision: number; disabled: boolean }) {
  const modules = useBusinessModules(), term = useTerminology(), router = useRouter()
  const [busy, setBusy] = useState(false), [error, setError] = useState("")
  if (!modules.enabled("salesOrders") || !modules.can(["salesOrders.read", "salesOrders.create", "quotations.read"])) return null
  async function create() {
    setBusy(true); setError("")
    try {
      const row = await orderRequest<{ id: string }>("/api/sales-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotationId, revision }) })
      router.push(`/sales-orders/${row.id}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <><Button type="button" variant="outline" disabled={disabled} loading={busy} onClick={create}>{term("salesOrders.order.singular", "Create sales order", "Create {label}")}</Button>{error && <p role="alert" className="max-w-sm text-sm text-destructive">{error}</p>}</>
}
