"use client"
import * as React from "react"
import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { StaffOption } from "@/types/shifts"

type Choice = StaffOption & { eligible: boolean; retained: boolean }
type View = { key: string; items: Choice[]; selected: Choice[]; total: number; totalPages: number }
export function WorkforceStaffPicker({ family, action, sourceId, startDate, endDate, headers, value, onChange, multiple = false, id, selected, all = false }: {
  family: "SCHEDULE" | "PATTERN"; action: "browse" | "create" | "edit"; sourceId?: string; startDate?: string; endDate?: string
  headers?: () => Promise<Record<string, string>>; value: string[]; onChange: (ids: string[]) => void
  multiple?: boolean; id: string; selected?: StaffOption[]; all?: boolean
}) {
  const [q, setQ] = React.useState(""), [page, setPage] = React.useState(1)
  const [view, setView] = React.useState<View | null>(null), [error, setError] = React.useState("")
  const [remembered, setRemembered] = React.useState<StaffOption[]>([])
  const ids = value.filter(id => id !== "all").join(",")
  const key = JSON.stringify([family, action, sourceId, startDate, endDate, ids, q, page])
  const valid = action === "browse" || !!startDate && (!endDate || endDate >= startDate)
  React.useEffect(() => {
    const controller = new AbortController()
    setError("")
    if (!valid) return
    const timer = setTimeout(() => void (async () => {
      try {
        const query = new URLSearchParams({ family, action, selected: ids, q, page: String(page), pageSize: "20" })
        if (sourceId) query.set("sourceId", sourceId)
        if (startDate) query.set("startDate", startDate)
        if (endDate) query.set("endDate", endDate)
        const response = await fetch(`/api/shifts/staff-choices?${query}`, { headers: action === "create" ? await headers?.() : undefined, cache: "no-store", signal: controller.signal })
        const data = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) {
          if (response.status !== 409) setRemembered([])
          throw new Error(data.error || "Unable to load staff choices.")
        }
        if (page > data.totalPages) { setPage(data.totalPages); return }
        setView({ ...data, key })
        setRemembered(data.selected)
      } catch (error) { if (!controller.signal.aborted) { setView(null); setError(error instanceof Error ? error.message : "Unable to load staff choices.") } }
    })(), 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [family, action, sourceId, startDate, endDate, headers, ids, q, page, key, valid])
  const ready = valid && view?.key === key
  const label = (staff: StaffOption) => staff.name?.trim() || staff.email
  const retained = ready ? view.selected : [...remembered, ...selected ?? []].filter(staff => value.includes(staff.id))
  const choices = ready ? view.items.filter(staff => action === "browse" || staff.eligible || value.includes(staff.id)) : []
  const message = !valid ? "Choose valid assignment dates first." : error || (!ready ? "Loading staff choices..." : "No matching eligible staff.")
  const search = (q: string) => { setQ(q); setPage(1) }
  const choose = (ids: string[]) => {
    setRemembered([...choices, ...retained].filter(staff => ids.includes(staff.id)))
    onChange(ids)
  }
  return <div className="space-y-2">
    {!multiple && <label htmlFor={id} className="sr-only">{id.includes("filter") ? "Staff filter" : id.includes("target") ? "Target staff" : "Staff"}</label>}
    {multiple ? <>
      <Input id={id} aria-label="Search eligible staff" value={q} maxLength={160} onChange={event => search(event.target.value)} placeholder="Search eligible staff" />
      {value.length > 0 && <div className="flex flex-wrap gap-2">{value.map(staffId => <Button key={staffId} type="button" variant="outline" size="sm" onClick={() => choose(value.filter(id => id !== staffId))}>{retained.find(staff => staff.id === staffId) ? label(retained.find(staff => staff.id === staffId)!) : "Selected staff"} - Remove</Button>)}</div>}
      {ready ? <div className="grid gap-2 sm:grid-cols-2">{choices.map(staff => <label key={staff.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(staff.id)} disabled={!value.includes(staff.id) && (!staff.eligible || value.length >= 100)} onChange={event => choose(event.target.checked ? [...value, staff.id] : value.filter(id => id !== staff.id))} />{label(staff)}{!staff.eligible && <span className="text-xs text-muted-foreground">Saved assignment</span>}</label>)}</div> : !error ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </> : <SearchableSelect id={id} value={value[0] ?? ""} selectedOption={value[0] === "all" ? { value: "all", label: "All staff" } : retained[0] ? { value: retained[0].id, label: label(retained[0]) } : undefined} options={[...(all ? [{ value: "all", label: "All staff" }] : []), ...choices.map(staff => ({ value: staff.id, label: label(staff) }))]} onChange={id => choose([id])} onSearchChange={search} placeholder="Select staff" emptyLabel={message} disabled={!valid} />}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {ready && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{view.total} matching staff</span><Button type="button" variant="ghost" size="sm" aria-label="Previous staff choices" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page} / {view.totalPages}</span><Button type="button" variant="ghost" size="sm" aria-label="Next staff choices" disabled={page >= view.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div>}
    {action !== "browse" && <p className="text-xs text-muted-foreground">Choices require workplace coverage for the entire window in this office. Saved assignments remain selected; saving rechecks current access and dates.</p>}
  </div>
}
