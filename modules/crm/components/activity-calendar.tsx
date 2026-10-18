"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, Filters, pageClass } from "@/components/erp/page"
import { Select } from "@/components/erp/controls"
import * as React from "react"
import Link from "@/platform/access/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BusinessCalendar, type BusinessCalendarMove } from "@/components/business-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { weekdayToSchedulerFirstDay } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import type { CrmWorkRow, WorkListResponse } from "@/types/crm-work"
import { wallTime, wallTimeToInstant } from "../work-time"
import { ActivityTypeSelect, activityTypeFilter } from "./activity-type-select"
import { workForm, workPayload } from "./work-schedule-fields"
import { RecordSelect } from "@/components/erp/record-select"
import { selectClass } from "./record-list"

const colors = { TASK: "#64748b", CALL: "#2563eb", MEETING: "#7c3aed", EMAIL: "#059669" }
export function ActivityCalendar() {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const router = useRouter()
  const [settings, setSettings] = React.useState<AppSettingsPayload | null>(null)
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null)
  const [items, setItems] = React.useState<CrmWorkRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [scope, setScope] = React.useState("mine")
  const [owner, setOwner] = React.useState("")
  const [type, setType] = React.useState("")
  const [state, setState] = React.useState("open")
  const [q, setQ] = React.useState("")
  const [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/settings/display", { signal: controller.signal, cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load calendar settings."); setSettings(data.settings) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [])
  React.useEffect(() => {
    if (!range || !settings) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError(""); setItems([]); setTotal(0)
      const params = new URLSearchParams({ ...range, scope, state, q, pageSize: "100", ...activityTypeFilter(type), ...(owner ? { assignedUserId: owner } : {}) })
      const get = async (page: number): Promise<WorkListResponse> => { const response = await fetch(`/api/crm/work?${params}&page=${page}`, { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load calendar."); return data }
      try {
        const first = await get(1), rows = [...first.items]
        for (let page = 2; page <= Math.min(first.totalPages, 5); page++) rows.push(...(await get(page)).items)
        if (!controller.signal.aborted) { setItems([...new Map(rows.map(row => [row.id, row])).values()]); setTotal(first.total); setCanManage(first.canManage) }
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setItems([]) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [range, settings, scope, state, q, type, owner, revision])
  const onRange = React.useCallback((from: string, to: string) => setRange(previous => previous?.from === from && previous.to === to ? previous : { from, to }), [])
  const timeZone = settings?.timeZone || "UTC"
  async function move(change: BusinessCalendarMove) {
    const record = items.find(row => row.id === change.id)
    if (!record || !record.canEdit || saving) return
    setSaving(true); setError("")
    try {
      const values = { ...workForm(record, timeZone), dueOn: change.date, startsLocal: change.startsLocal, endsLocal: change.endsLocal }
      if (record.reminderAt) {
        if (record.startsAt && change.startsLocal) {
          const delta = Date.parse(wallTimeToInstant(change.startsLocal, timeZone)) - Date.parse(record.startsAt)
          values.reminderLocal = wallTime(new Date(Date.parse(record.reminderAt) + delta), timeZone)
        } else {
          const prior = wallTime(record.reminderAt, timeZone)
          const days = Date.parse(`${change.date}T00:00:00Z`) - Date.parse(`${record.dueOn.slice(0, 10)}T00:00:00Z`)
          values.reminderLocal = new Date(Date.parse(`${prior.slice(0, 10)}T00:00:00Z`) + days).toISOString().slice(0, 10) + prior.slice(10)
        }
      }
      const response = await fetch(`/api/crm/work/${record.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...workPayload(values, timeZone), version: record.version, status: record.status }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || readTerm("crm.activity.singular", "Unable to reschedule activity.", "Unable to reschedule {label}."))
      toast.success(term("crm.activity.singular", "Activity rescheduled.", "{label} rescheduled."))
    } catch (error) { setError((error as Error).message); toast.error((error as Error).message) }
    finally { setSaving(false); setRevision(value => value + 1) }
  }
  const entries = React.useMemo(() => items.map(item => ({ id: item.id, title: `${item.activityTypeName || item.type}: ${item.title} Â· ${item.contact.name}`, date: item.dueOn.slice(0, 10), startsAt: item.startsAt, endsAt: item.endsAt, editable: item.canEdit && ["OPEN", "IN_PROGRESS"].includes(item.status), color: ["COMPLETED", "CANCELLED"].includes(item.status) ? "#6b7280" : colors[item.type] })), [items])
  return <section className={pageClass}><AccessPageHeader title={term("crm.activity.singular", "Activity calendar", "{label} calendar")} actions={<><Button variant="outline" asChild><Link href="/crm/activities">My Work</Link></Button><Button asChild><Link href="/crm/activities/new">{term("crm.activity.singular", "Schedule activity", "Schedule {label}")}</Link></Button></>} />
    <p className="text-sm text-muted-foreground">Dates and times use {timeZone}. {term("crm.activity.singular", "Click an activity to see its customer history and record an outcome.", "Click a {label} to see its customer history and record an outcome.")} {term("crm.activity.plural", "Drag open activities to reschedule.", "Drag open {label} to reschedule.")}</p>
    <Surface><div className="flex flex-wrap items-end gap-3"><FormField id="calendar-search" label="Search"><Input id="calendar-search" value={q} onChange={event => setQ(event.target.value)} /></FormField><Filters activeCount={[scope !== "mine", !!type, state !== "open", !!owner].filter(Boolean).length} onReset={() => { setScope("mine"); setType(""); setState("open"); setOwner("") }}><FormField id="calendar-scope" label="Scope"><Select id="calendar-scope" className={selectClass} value={scope} onValueChange={event => { setScope(event); setOwner("") }}><option value="mine">Assigned to me</option><option value="visible">All I can access</option></Select></FormField><FormField id="calendar-type" label="Type"><div className="min-w-0 w-60"><ActivityTypeSelect id="calendar-type" filter value={type} onChange={value => { setType(value) }} /></div></FormField><FormField id="calendar-state" label="Status"><Select id="calendar-state" className={selectClass} value={state} onValueChange={event => setState(event)}><option value="open">Open</option><option value="all">All statuses</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></Select></FormField>{canManage && scope === "visible" && <div className="w-52"><FormField id="calendar-owner" label="Staff"><RecordSelect id="calendar-owner" endpoint="/api/crm/assignees" value={owner} onChange={setOwner} /></FormField></div>}</Filters><Button variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Refresh</Button></div></Surface>
    {error && <p role="alert" className="text-destructive">{error}</p>}{loading && <p role="status">Loading calendarâ€¦</p>}{total > items.length && !loading && <p role="status">Showing {items.length} of {total} {term("crm.activity.plural", "activities. Narrow the filters or use My Work to see the remaining records.", "{label}. Narrow the filters or use My Work to see the remaining records.")}</p>}
    {settings && <div className="min-w-0 overflow-hidden rounded-xl border bg-card"><BusinessCalendar entries={entries} timeZone={timeZone} firstDayOfWeek={weekdayToSchedulerFirstDay(settings.firstDayOfWeek)} today={wallTime(new Date(), timeZone).slice(0, 10)} busy={loading || saving} onRange={onRange} onOpen={id => router.push(`/crm/activities/${id}`)} onMove={change => void move(change)} onCreate={(date, startsLocal, endsLocal) => {
      try { const query = new URLSearchParams({ dueOn: date, ...(startsLocal ? { startsAt: wallTimeToInstant(startsLocal, timeZone), endsAt: wallTimeToInstant(endsLocal, timeZone) } : {}) }); router.push(`/crm/activities/new?${query}`) } catch (error) { setError((error as Error).message) }
    }} /></div>}
  </section>
}
