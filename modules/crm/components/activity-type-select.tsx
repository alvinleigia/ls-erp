"use client"
import * as React from "react"
import { SearchableSelect } from "@/components/searchable-select"
import { workTypes } from "../work-validation"
import type { WorkType } from "@/types/crm-work"

type Choice = { id: string; name: string; baseType: WorkType; defaultInstructions: string; archived?: boolean }
export const activityTypeFilter = (value: string): Record<string, string> => !value ? {} : workTypes.includes(value as WorkType) ? { type: value } : { activityTypeId: value }
export function ActivityTypeSelect({ id, value, selectedName, onChange, filter = false }: {
  id: string; value: string; selectedName?: string | null; onChange: (value: string, choice?: Choice) => void; filter?: boolean
}) {
  const [q, setQ] = React.useState("")
  const [rows, setRows] = React.useState<Choice[]>([])
  const [picked, setPicked] = React.useState<Choice>()
  const [message, setMessage] = React.useState("Loading types…")
  React.useEffect(() => {
    if (!value || selectedName || workTypes.includes(value as WorkType)) return
    const controller = new AbortController()
    void fetch(`/api/crm/activity-types/${encodeURIComponent(value)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.ok) { const row = await response.json(); if (!controller.signal.aborted) setPicked(row) }
    }).catch(() => {})
    return () => controller.abort()
  }, [value, selectedName])
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/crm/activity-types?pageSize=20&q=${encodeURIComponent(q)}${filter ? "&includeArchived=true" : ""}`, { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error()
        const data = await response.json()
        if (!controller.signal.aborted) { setRows(data.items); setMessage(data.total > 20 ? "Refine your search to find more types." : "No matching types.") }
      } catch { if (!controller.signal.aborted) { setRows([]); setMessage("Unable to load custom types. Try searching again.") } }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [q, filter])
  const builtins = workTypes.map(type => ({ value: type, label: type.charAt(0) + type.slice(1).toLowerCase() + (filter ? " (all types with this behaviour)" : "") })).filter(option => option.label.toLowerCase().includes(q.toLowerCase()))
  const options = [...(filter && !q ? [{ value: "", label: "All types" }] : []), ...builtins, ...rows.map(row => ({ value: row.id, label: (row.id === value && selectedName ? selectedName : row.name) + (row.archived ? " (archived)" : "") }))]
  const retained = options.find(option => option.value === value) || (value ? { value, label: picked?.id === value ? picked.name : selectedName || "Selected activity type" } : undefined)
  return <SearchableSelect id={id} value={value} selectedOption={retained} options={options} placeholder={filter ? "All types" : "Choose activity type"} emptyLabel={message}
    onSearchChange={next => { if (next === q) return; const current = rows.find(row => row.id === value); if (current) setPicked(current); setRows([]); setQ(next) }}
    onChange={next => { const choice = rows.find(row => row.id === next); setPicked(choice); onChange(next, choice) }} />
}
