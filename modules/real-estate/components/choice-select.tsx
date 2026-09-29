"use client"
import * as React from "react"
import { RecordSelect } from "@/modules/crm/components/record-select"
import { Button } from "@/components/ui/button"
import type { ChoiceKind } from "../choices"

export function ChoiceSelect({ kind, id, value, name, onChange, disabled, clearable, includeArchived, placeholder }: {
  kind: ChoiceKind; id: string; value: string; name?: string | null; onChange: (value: string, name?: string) => void;
  disabled?: boolean; clearable?: boolean; includeArchived?: boolean; placeholder?: string;
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; name: string } | null>(null)
  React.useEffect(() => {
    if (!value || name) return
    const controller = new AbortController()
    fetch(`/api/real-estate/choices/${kind}/${encodeURIComponent(value)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) setLoaded(await response.json())
    }).catch(() => {})
    return () => controller.abort()
  }, [kind, value, name])
  const label = name || (loaded?.id === value ? loaded.name : value)
  return <div className="min-w-0 space-y-1"><RecordSelect id={id} endpoint={`/api/real-estate/choices/${kind}${includeArchived ? "?includeArchived=true" : ""}`} value={value} selected={value ? { value, label } : undefined} preferSelectedOption={!!name} onChange={(next, option) => onChange(next, option?.label)} disabled={disabled} placeholder={placeholder} />
    {clearable && value && <Button type="button" size="sm" variant="link" disabled={disabled} onClick={() => onChange("")}>Clear selection<span className="sr-only"> {id}</span></Button>}
  </div>
}
