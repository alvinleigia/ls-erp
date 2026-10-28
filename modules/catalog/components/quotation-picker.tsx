"use client"
import * as React from "react"
import type { QuotationLineAddonProps } from "@/modules/sales-documents/components/line-addon"
import { useBusinessModules } from "@/platform/module-provider"
import { RecordSelect } from "@/components/erp/record-select"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
export function CatalogQuotationPicker({ line, onChange, currency, disabled, id }: QuotationLineAddonProps) {
  const modules = useBusinessModules()
  const [error, setError] = React.useState(""), [loading, setLoading] = React.useState(false)
  const sequence = React.useRef(0)
  React.useEffect(() => { sequence.current++; setLoading(false) }, [line, currency])
  React.useEffect(() => () => { sequence.current++ }, [])
  const enabled = modules.enabled("catalog") && modules.can("catalogItems.read")
  async function pick(itemId: string) {
    const request = ++sequence.current
    setError(""); setLoading(true)
    try {
      const response = await fetch(`/api/catalog/items/${encodeURIComponent(itemId)}`, { cache: "no-store" })
      const row = await response.json(); if (!response.ok) throw Error(row.error || "Unable to load item.")
      if (row.currency !== currency) throw Error("Choose an item in the quotation currency.")
      if (row.archived || row.availability !== "AVAILABLE" || row.reservationState) throw Error("This item is no longer available.")
      if (request === sequence.current) onChange({ description: `${row.code} · ${row.name}`, quantity: "1", unit: row.unit, rate: String(row.price), catalogItemId: row.id, catalogItemVersion: row.version })
    } catch (e) { if (request === sequence.current) setError((e as Error).message) }
    finally { if (request === sequence.current) setLoading(false) }
  }
  if (!enabled && !line.catalogItemId) return null
  return <div className="space-y-2 sm:col-span-2 lg:col-span-4">
    {enabled && <FormField id={id} label="Catalog item (optional)" error={error}><RecordSelect showCode id={id} endpoint={`/api/catalog/items?availability=AVAILABLE&currency=${encodeURIComponent(currency)}`} value={line.catalogItemId || ""} selected={line.catalogItemId ? { value: line.catalogItemId, label: line.description } : undefined} onChange={pick} disabled={disabled || loading} placeholder="Search item name or code..." /></FormField>}
    {line.catalogItemId && <Button type="button" variant="ghost" disabled={disabled || loading || (!enabled&&!line.refreshCatalogItem)} onClick={()=>onChange({...line,refreshCatalogItem:!line.refreshCatalogItem})}>{line.refreshCatalogItem?"Keep saved item details":"Refresh saved item details"}</Button>}
    {line.refreshCatalogItem && <p className="text-xs text-muted-foreground">Current item details will be checked and saved in the new revision.</p>}
    {line.catalogItemId && <Button type="button" variant="ghost" disabled={disabled || loading} onClick={() => { const { catalogItemId, catalogItemVersion, refreshCatalogItem, ...manual } = line; void catalogItemId; void catalogItemVersion; void refreshCatalogItem; onChange(manual) }}>Remove catalog link</Button>}
    {line.catalogItemId && <p className="text-xs text-muted-foreground">The saved item reference is retained. This quotation does not reserve or sell the item.</p>}
  </div>
}
