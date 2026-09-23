"use client"
import * as React from "react"
import { SearchableSelect } from "@/components/searchable-select"
import type { ListResponse } from "@/types/api"

type Option = { value: string; label: string }
export function RecordSelect({ endpoint, value, selected, onChange, id, disabled = false, labelField = "name" }: {
  endpoint: string; value: string; selected?: Option; onChange: (value: string) => void; id: string; disabled?: boolean; labelField?: "name" | "title";
}) {
  const [q, setQ] = React.useState("")
  const [options, setOptions] = React.useState<Option[]>([])
  const [picked, setPicked] = React.useState<Option | undefined>(undefined)
  const [message, setMessage] = React.useState("Type to search.")
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}pageSize=20&q=${encodeURIComponent(q)}`, { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error("Unable to load choices.")
        const data: ListResponse<{ id: string; name?: string | null; title?: string }> = await response.json()
        setOptions(data.items.map(row => ({ value: row.id, label: row[labelField] || "Unnamed record" })))
        setMessage(data.total > 20 ? "Refine your search to find more choices." : "No matching records.")
      } catch {
        if (!controller.signal.aborted) { setOptions([]); setMessage("Unable to load choices. Try searching again.") }
      }
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [endpoint, q, labelField])
  const retained = picked?.value === value ? picked : selected
  const choices = retained && !options.some(option => option.value === retained.value) ? [retained, ...options] : options
  return <SearchableSelect id={id} value={value} onChange={next => { setPicked(choices.find(option => option.value === next)); onChange(next) }} options={choices} onSearchChange={setQ} placeholder="Search and select…" emptyLabel={message} disabled={disabled} />
}
