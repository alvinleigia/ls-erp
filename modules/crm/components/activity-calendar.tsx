"use client"
import * as React from "react"
import Link from "next/link"
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
import { workTypes } from "../work-validation"
import { workForm, workPayload } from "./work-schedule-fields"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"

const colors = { TASK: "#64748b", CALL: "#2563eb", MEETING: "#7c3aed", EMAIL: "#059669" }
export function ActivityCalendar() {
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
      const params = new URLSearchParams({ ...range, scope, state, q, pageSize: "100", ...(type ? { type } : {}), ...(owner ? { assignedUserId: owner } : {}) })
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
      if (!response.ok) throw new Error(result.error || "Unable to reschedule activity.")
      toast.success("Activity rescheduled.")
    } catch (error) { setError((error as Error).message); toast.error((error as Error).message) }
    finally { setSaving(false); setRevision(value => value + 1) }
  }
  const entries = React.useMemo(() => items.map(item => ({ id: item.id, title: `${item.type}: ${item.title} · ${item.contact.name}`, date: item.dueOn.slice(0, 10), startsAt: item.startsAt, endsAt: item.endsAt, editable: item.canEdit && ["OPEN", "IN_PROGRESS"].includes(item.status), color: ["COMPLETED", "CANCELLED"].includes(item.status) ? "#6b7280" : colors[item.type] })), [items])
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Activity calendar</h1><div className="flex gap-2"><Button variant="outline" asChild><Link href="/crm/activities">My Work</Link></Button><Button asChild><Link href="/crm/activities/new">Schedule activity</Link></Button></div></div>
    <p className="text-sm text-muted-foreground">Dates and times use {timeZone}. Click an activity to see its customer history and record an outcome. Drag open activities to reschedule.</p>
    <div className="flex flex-wrap items-end gap-3"><FormField id="calendar-search" label="Search"><Input id="calendar-search" value={q} onChange={event => setQ(event.target.value)} /></FormField><FormField id="calendar-scope" label="Scope"><select id="calendar-scope" className={selectClass} value={scope} onChange={event => { setScope(event.target.value); setOwner("") }}><option value="mine">Assigned to me</option><option value="visible">All I can access</option></select></FormField><FormField id="calendar-type" label="Type"><select id="calendar-type" className={selectClass} value={type} onChange={event => setType(event.target.value)}><option value="">All types</option>{workTypes.map(type => <option key={type}>{type}</option>)}</select></FormField><FormField id="calendar-state" label="Status"><select id="calendar-state" className={selectClass} value={state} onChange={event => setState(event.target.value)}><option value="open">Open</option><option value="all">All statuses</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></FormField>{canManage && scope === "visible" && <div className="w-52"><FormField id="calendar-owner" label="Staff"><RecordSelect id="calendar-owner" endpoint="/api/crm/assignees" value={owner} onChange={setOwner} /></FormField></div>}<Button variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}{loading && <p role="status">Loading calendar…</p>}{total > items.length && !loading && <p role="status">Showing {items.length} of {total} activities. Narrow the filters or use My Work to see the remaining records.</p>}
    {settings && <BusinessCalendar entries={entries} timeZone={timeZone} firstDayOfWeek={weekdayToSchedulerFirstDay(settings.firstDayOfWeek)} today={wallTime(new Date(), timeZone).slice(0, 10)} busy={loading || saving} onRange={onRange} onOpen={id => router.push(`/crm/activities/${id}`)} onMove={change => void move(change)} onCreate={(date, startsLocal, endsLocal) => {
      try { const query = new URLSearchParams({ dueOn: date, ...(startsLocal ? { startsAt: wallTimeToInstant(startsLocal, timeZone), endsAt: wallTimeToInstant(endsLocal, timeZone) } : {}) }); router.push(`/crm/activities/new?${query}`) } catch (error) { setError((error as Error).message) }
    }} />}
  </section>
}
