"use client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Select } from "@/components/erp/controls"
import type { ItemCharge } from "./item-charges"

export function ItemChargeFields({ value, onChange, disabled, readOnly, id }: { value: ItemCharge[]; onChange: (value: ItemCharge[]) => void; disabled?: boolean; readOnly?: boolean; id: string }) {
  if (readOnly) return value.length ? <ul className="space-y-2 break-words">{value.map((charge, i) => <li key={i}><strong>{charge.label}</strong>: {charge.value}{charge.kind === "PERCENT" ? "% of this item line" : " (fixed amount per line)"} · {charge.included ? "Included in consideration" : "Extra charge"}{charge.due ? ` · ${charge.due}` : ""}</li>)}</ul> : <p className="text-sm text-muted-foreground">No item charges.</p>
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    {value.map((charge, i) => {
      const change = (patch: Partial<ItemCharge>) => onChange(value.map((row, n) => n === i ? { ...row, ...patch } : row))
      return <div key={i} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField id={`${id}-name-${i}`} label="Item charge name"><Input id={`${id}-name-${i}`} required maxLength={150} value={charge.label} onChange={e => change({ label: e.target.value })} /></FormField>
        <FormField id={`${id}-kind-${i}`} label="Item charge calculation"><Select id={`${id}-kind-${i}`} value={charge.kind} onValueChange={kind => change({ kind: kind as ItemCharge["kind"] })}><option value="PERCENT">Percentage of this line</option><option value="FIXED">Fixed amount per line</option></Select></FormField>
        <FormField id={`${id}-value-${i}`} label={charge.kind === "PERCENT" ? "Item charge percentage" : "Item charge amount"} help={charge.kind === "PERCENT" ? "Enter 8 for 8%. Uses this line's quantity × rate before discount; other items are excluded." : "Applied once to this whole priced line, in the document currency."}><Input id={`${id}-value-${i}`} required inputMode="decimal" value={charge.value} onChange={e => change({ value: e.target.value })} /></FormField>
        <FormField id={`${id}-treatment-${i}`} label="Item charge treatment"><Select id={`${id}-treatment-${i}`} value={charge.included ? "included" : "extra"} onValueChange={v => change({ included: v === "included" })}><option value="included">Included in consideration</option><option value="extra">Extra charge</option></Select></FormField>
        <FormField id={`${id}-group-${i}`} label="Item charge group (optional)"><Input id={`${id}-group-${i}`} maxLength={100} value={charge.group} onChange={e => change({ group: e.target.value })} /></FormField>
        <FormField id={`${id}-due-${i}`} label="Item charge due / conditions"><Input id={`${id}-due-${i}`} maxLength={500} value={charge.due} onChange={e => change({ due: e.target.value })} /></FormField>
        <Button type="button" variant="ghost" className="justify-self-start" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove item charge</Button>
      </div>
    })}
    <Button type="button" variant="outline" disabled={disabled || value.length >= 10} onClick={() => onChange([...value, { label: "", group: "", kind: "PERCENT", value: "", included: true, due: "" }])}>Add item charge</Button>
  </fieldset>
}
