"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RecordSelect } from "@/components/erp/record-select"
import { ConfirmAction } from "@/components/erp/confirm-action"
import { useBusinessModules } from "@/platform/module-provider"
import type { WorkplaceView } from "@/modules/workforce/workplace-service"
import { useDateFormatter } from "@/hooks/use-date-formatter"

export function StaffWorkplacePanel({ staffId }: { staffId: string }) {
  const { enabled, can } = useBusinessModules()
  const { formatDateOnly } = useDateFormatter()
  const available = enabled("shifts") && can("shiftRoster.read")
  const [view, setView] = React.useState<WorkplaceView | null>(null)
  const [page, setPage] = React.useState(1)
  const [officeId, setOfficeId] = React.useState("")
  const [startsOn, setStartsOn] = React.useState("")
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const loadSequence = React.useRef(0)
  React.useEffect(() => {
    if (!available) return
    const sequence = ++loadSequence.current, controller = new AbortController()
    setLoading(true); setView(null); setOfficeId(""); setError("")
    void (async () => {
      try {
        const response = await fetch(`/api/shifts/workplaces?staffId=${encodeURIComponent(staffId)}&page=${page}&pageSize=10`, { cache: "no-store", signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? "Unable to load workplace.")
        if (loadSequence.current !== sequence) return
        const current = data as WorkplaceView
        setView(current)
        const earliest = current.latest?.startDate && current.latest.startDate >= current.today ? new Date(current.latest.startDate + "T00:00:00Z") : null
        if (earliest) earliest.setUTCDate(earliest.getUTCDate() + 1)
        setStartsOn(earliest ? earliest.toISOString().slice(0, 10) : current.today)
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to load workplace.")
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [staffId, available, page, revision])
  if (!available) return null
  async function save(action: "assign" | "cancel") {
    if (!view || saving) return
    setSaving(true); setError("")
    try {
      const response = await fetch("/api/shifts/workplaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, staffId, version: view.version,
        ...(action === "assign" ? { officeId, startsOn, ...(view.latest ? { fromId: view.latest.id } : {}) } : { assignmentId: view.latest?.id }),
      }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Unable to change workplace.")
      setCancelOpen(false); setPage(1); setRevision(value => value + 1)
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to change workplace.") }
    finally { setSaving(false) }
  }
  return <section className="space-y-4 rounded-xl border p-5" aria-label="Staff workplace">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Workplace</h2><p className="text-sm text-muted-foreground">Dated working office assignments. Office and record access are managed separately.</p></div><Button type="button" variant="outline" disabled={saving || loading} onClick={() => setRevision(value => value + 1)}>Refresh workplace</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p role="status">Loading workplace...</p> : view && <>
      <p className="text-sm">Current workplace: <strong>{view.current ? `${view.current.companyName} / ${view.current.officeName}` : "No current workplace visible"}</strong></p>
      {view.canAssign && <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Resolve shifts, plans and bookings that overlap the change first. A transfer does not move scheduled work or change access.</p>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`workplace-office-${staffId}`}>Working office</Label><RecordSelect key={`${staffId}-${revision}-${page}`} id={`workplace-office-${staffId}`} endpoint={`/api/shifts/workplaces/offices?staffId=${encodeURIComponent(staffId)}`} value={officeId} onChange={setOfficeId} disabled={saving} /></div>
          <div className="space-y-2"><Label htmlFor={`workplace-date-${staffId}`}>Effective date</Label><Input id={`workplace-date-${staffId}`} type="date" min={view.today} value={startsOn} disabled={saving} onChange={event => setStartsOn(event.target.value)} /></div></div>
        <div className="flex flex-wrap gap-2"><Button type="button" loading={saving} loadingText="Saving..." disabled={!officeId || !startsOn} onClick={() => void save("assign")}>{view.latest ? "Schedule workplace transfer" : "Assign workplace"}</Button>
          {view.canCancel && <Button type="button" variant="outline" disabled={saving} onClick={() => setCancelOpen(true)}>Cancel future transfer</Button>}</div>
      </div>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Workplace assignment history</caption><thead><tr className="border-b"><th className="py-2 pr-3">Office</th><th className="py-2 pr-3">From</th><th className="py-2 pr-3">Through</th><th className="py-2">Status</th></tr></thead><tbody>{view.items.map(item => <tr key={item.id} className="border-b last:border-0"><td className="py-3 pr-3">{item.companyName} / {item.officeName}</td><td className="py-3 pr-3">{item.startDate ? formatDateOnly(item.startDate) : "Start not recorded"}</td><td className="py-3 pr-3">{item.endDate ? formatDateOnly(item.endDate) : item.canceledAt ? "-" : "Ongoing"}</td><td className="py-3">{item.canceledAt ? "Canceled" : item.startDate && item.startDate > view.today ? "Scheduled" : item.endDate && item.endDate < view.today ? "Previous" : "Current"}</td></tr>)}</tbody></table>
        {!view.items.length && <p className="py-3 text-sm text-muted-foreground">No workplace assignments visible.</p>}</div>
      {view.total > 10 && <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={saving || page === 1} onClick={() => setPage(value => value - 1)}>Previous placements</Button><span className="text-sm">Page {page} of {Math.ceil(view.total / 10)}</span><Button type="button" variant="outline" disabled={saving || page * 10 >= view.total} onClick={() => setPage(value => value + 1)}>Next placements</Button></div>}
    </>}
    {cancelOpen && <ConfirmAction title="Cancel future workplace transfer?" description={<><span>The previous workplace will continue. Scheduled work must be resolved first; office access stays the same.</span>{error && <span role="alert" className="mt-3 block text-destructive">{error}</span>}</>} label="Cancel transfer" busy={saving} onCancel={() => setCancelOpen(false)} onConfirm={() => void save("cancel")} />}
  </section>
}
