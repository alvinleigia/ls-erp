"use client"
import * as React from "react"
import { SearchableSelect } from "@/components/searchable-select"
import { Button } from "@/components/ui/button"
import { membershipPreviewKey, type MembershipSubject, type MembershipCompany, type MembershipOffice, type OfficeChoice, type OfficeMembershipDraft } from "@/types/companies"

type Choice = { id: string; label: string; office?: MembershipOffice; company?: MembershipCompany }
export type MembershipValidation = { key: string; valid: boolean }
const officeLabel = (office: MembershipOffice) => `${office.company.name} / ${office.name} (${office.code})${office.archived || office.company.archived ? " (closed)" : ""}`
export { officeLabel }
const creationChoice = (office: OfficeChoice): Choice => ({ id: office.id, label: `${office.companyName} / ${office.name} (${office.code})` })

export function MembershipChoice({ kind, id, subject, draft, value = "", saved, disabled = false, refresh = 0, onPick, onValidation, onDenied }: {
  kind: "office" | "company" | "creation"; id: string; subject: MembershipSubject; draft: OfficeMembershipDraft; value?: string
  saved?: MembershipOffice | null; disabled?: boolean; refresh?: number
  onPick: (choice: Choice | null) => void; onValidation?: (validation: MembershipValidation) => void; onDenied: () => void
}) {
  const [q, setQ] = React.useState(""), [page, setPage] = React.useState(1), [error, setError] = React.useState("")
  const [picked, setPicked] = React.useState<Choice | null>(null)
  const baseKey = kind === "creation" ? membershipPreviewKey(subject, draft) : kind
  const key = JSON.stringify([baseKey, q, page, refresh])
  const [view, setView] = React.useState<{ key: string; items: Choice[]; selected: Choice | null; total: number; totalPages: number } | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    setError("")
    const timer = setTimeout(() => void (async () => {
      try {
        const proposed = kind === "creation" ? JSON.parse(baseKey) as { subject: MembershipSubject; draft: OfficeMembershipDraft } : null
        const target = proposed?.subject
        const response = proposed && target
          ? await fetch(target.kind === "user" ? `/api/access/users/${encodeURIComponent(target.userId)}/offices/creation-choices` : "/api/access/initial-office-choices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeIds: proposed.draft.officeIds, companies: proposed.draft.companies, selected: value || null, q, page, pageSize: 20, ...(target.kind === "new" ? { role: target.role, status: target.status } : {}) }), signal: controller.signal, cache: "no-store" })
          : await fetch(`/api/${kind === "office" ? "offices" : "companies"}?${new URLSearchParams({ status: "all", q, page: String(page), pageSize: "20" })}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) { if ([401, 403].includes(response.status)) onDenied(); throw new Error(data.error || "Unable to load choices.") }
        if (kind === "creation") onValidation?.({ key: baseKey, valid: !value || !!data.selected })
        if (page > data.totalPages) { setPage(1); return }
        const items: Choice[] = kind === "creation" ? data.items.map(creationChoice) : kind === "office"
          ? data.items.map((office: MembershipOffice) => ({ id: office.id, label: officeLabel(office), office }))
          : data.items.map((company: MembershipCompany) => ({ id: company.id, label: `${company.name} (${company.code})${company.archived ? " (closed)" : ""}`, company }))
        setView({ key, items, selected: data.selected ? creationChoice(data.selected) : null, total: data.total, totalPages: data.totalPages })
      } catch (error) {
        if (!controller.signal.aborted) { setView(null); setError(error instanceof Error ? error.message : "Unable to load choices."); if (kind === "creation") onValidation?.({ key: baseKey, valid: false }) }
      }
    })(), 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [kind, baseKey, value, q, page, key, onValidation, onDenied])
  const ready = view?.key === key
  const selected = ready && view.selected || (picked?.id === value ? picked : saved?.id === value ? { id: value, label: officeLabel(saved) } : null)
  const currentLabel = !value ? "No creation office" : selected?.label || "Unavailable selection"
  const options = [...(kind === "creation" ? [{ value: "none", label: "No creation office" }] : []), ...(ready ? view.items.map(choice => ({ value: choice.id, label: choice.label })) : [])]
  return <div className="min-w-0 space-y-1">
    <SearchableSelect id={id} value={kind === "creation" ? value || "none" : ""} selectedOption={kind === "creation" ? { value: value || "none", label: currentLabel } : undefined} options={options} disabled={disabled} placeholder={kind === "office" ? "Search offices..." : kind === "company" ? "Search companies..." : "Choose creation office"} emptyLabel={error || (!ready ? "Loading choices..." : "No matching choices.")} onSearchChange={next => { setQ(next); if (next !== q) setPage(1) }} onChange={id => { const choice = id === "none" ? null : view?.items.find(item => item.id === id) ?? null; setPicked(choice); onPick(choice) }} />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {ready && <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span>{view.total} {kind === "creation" ? view.total === 1 ? "eligible office" : "eligible offices" : view.total === 1 ? "directory match" : "directory matches"}</span>{view.totalPages > 1 && <><Button type="button" size="sm" variant="ghost" disabled={disabled || page <= 1} aria-label={`Previous ${kind} choices`} onClick={() => setPage(page-1)}>Previous</Button><span>{page} / {view.totalPages}</span><Button type="button" size="sm" variant="ghost" disabled={disabled || page >= view.totalPages} aria-label={`Next ${kind} choices`} onClick={() => setPage(page+1)}>Next</Button></>}</div>}
  </div>
}
