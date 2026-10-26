"use client"
import * as React from "react"
import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import type { AppointmentStaffChoice, AppointmentStaffOption } from "@/types/appointments"
import type { RecordOffice } from "@/types/companies"

type Choice = AppointmentStaffChoice | RecordOffice
type View = { key: string; items: Choice[]; selected: Choice[]; total: number; totalPages: number; office?: RecordOffice }
type StaffScope = { family: "APPOINTMENT" | "ORDER"; action: "browse" | "create" | "edit"; sourceId?: string; startAt?: string; endAt?: string; officeId?: string; startDate?: string; endDate?: string }
export type BookingStaffScope = StaffScope & { headers?: () => Promise<Record<string, string>> }

function ChoicePicker({ kind, query, headers, id, value, onChange, fallback, valid = true, disabled = false, all = false }: {
  kind: "staff" | "office"; query: Record<string, string | undefined>; headers?: () => Promise<Record<string, string>>
  id: string; value: string; onChange: (id: string, choice?: Choice) => void; fallback?: AppointmentStaffOption; valid?: boolean; disabled?: boolean; all?: boolean
}) {
  const [q, setQ] = React.useState(""), [page, setPage] = React.useState(1)
  const [view, setView] = React.useState<View | null>(null), [error, setError] = React.useState("")
  const [denied, setDenied] = React.useState(false)
  const queryKey = JSON.stringify(query), key = JSON.stringify([kind, queryKey, value, q, page])
  React.useEffect(() => {
    const controller = new AbortController()
    if (!valid) return
    setError("")
    const timer = setTimeout(() => void (async () => {
      try {
        const params = new URLSearchParams({ q, page: String(page), pageSize: "20", selected: value === "all" ? "" : value })
        for (const [name, value] of Object.entries(JSON.parse(queryKey))) if (value) params.set(name, String(value))
        const response = await fetch(`/api/appointments/${kind}-choices?${params}`, { headers: headers ? await headers() : undefined, signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) { setDenied(response.status === 403 || response.status === 404); throw new Error(data.error || "Unable to load choices.") }
        setDenied(false)
        if (page > data.totalPages) { setPage(data.totalPages); return }
        setView({ ...data, selected: kind === "office" ? data.selected ? [data.selected] : [] : data.selected, key })
      } catch (error) { if (!controller.signal.aborted) { setView(null); setError(error instanceof Error ? error.message : "Unable to load choices.") } }
    })(), 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [kind, queryKey, value, q, page, key, valid, headers])
  const ready = valid && view?.key === key
  const label = (choice: Choice | AppointmentStaffOption) => "companyName" in choice ? `${choice.name} / ${choice.companyName}${choice.active ? "" : " (closed)"}` : choice.name?.trim() || ("email" in choice ? choice.email : "Staff")
  const selected = ready ? view.selected.find(choice => choice.id === value) : undefined
  const selectedLabel = value === "all" ? kind === "office" ? "All accessible offices" : "All staff" : selected ? label(selected) : !denied && !ready && fallback?.id === value ? label(fallback) : value ? kind === "office" ? "Selected office" : "Selected staff" : undefined
  const choices = ready ? view.items.filter(choice => kind === "office" || query.action === "browse" || ("eligible" in choice && choice.eligible) || choice.id === value) : []
  return <div className="space-y-1">
    <SearchableSelect id={id} value={value} selectedOption={selectedLabel ? { value, label: selectedLabel } : undefined} options={[...(all ? [{ value: "all", label: kind === "office" ? "All accessible offices" : "All staff" }] : []), ...choices.map(choice => ({ value: choice.id, label: label(choice) }))]} onChange={id => onChange(id, choices.find(choice => choice.id === id))} onSearchChange={q => { setQ(q); setPage(1) }} placeholder={kind === "office" ? "Select office" : "Select staff"} emptyLabel={!valid ? "Choose a service and valid booking time first." : error || (!ready ? "Loading choices..." : "No matching choices.")} disabled={!valid || disabled} />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {ready && <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span>{view.total} matching {kind === "office" ? "offices" : "staff"}</span>{view.totalPages > 1 && <><Button type="button" size="sm" variant="ghost" aria-label={`Previous ${kind} choices`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page} / {view.totalPages}</span><Button type="button" size="sm" variant="ghost" aria-label={`Next ${kind} choices`} disabled={page >= view.totalPages} onClick={() => setPage(page + 1)}>Next</Button></>}</div>}
    {kind === "staff" && query.action !== "browse" && <p className="text-xs text-muted-foreground">{ready && view.office ? `${view.office.companyName} / ${view.office.name}. ` : ""}{ready && value && (!selected || "eligible" in selected && !selected.eligible) ? "Saved or unavailable selection; changing the assignment requires current office and date coverage." : "Choices require workplace coverage for this office and the whole booking time."}</p>}
  </div>
}
export function BookingStaffPicker({ headers, value, onChange, selected, disabled, id, all, ...scope }: BookingStaffScope & {
  value: string; onChange: (id: string, choice?: AppointmentStaffOption) => void; selected?: AppointmentStaffOption; disabled?: boolean; id: string; all?: boolean
}) {
  const valid = scope.action === "browse" || !!scope.startAt && !!scope.endAt && Date.parse(scope.endAt) > Date.parse(scope.startAt)
  return <ChoicePicker kind="staff" query={scope} headers={scope.action === "create" ? headers : undefined} value={value} onChange={(id, choice) => onChange(id, choice as AppointmentStaffOption | undefined)} fallback={selected} valid={valid} disabled={disabled} id={id} all={all} />
}
export function BookingOfficePicker({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  return <ChoicePicker kind="office" query={{}} value={value} onChange={onChange} id={id} all />
}
