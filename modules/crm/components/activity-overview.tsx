"use client"
import { CrmPagination } from "./crm-pagination"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmSurface, crmPageClass } from "./crm-page"
import { CrmSelect } from "./crm-controls"
import * as React from "react"
import Link from "@/platform/access/link"
import { CalendarDays, ChevronDown, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { ActivityTypeSelect, activityTypeFilter } from "./activity-type-select"
import type { ActivityOverview as Overview, StaffActivityRow, FollowUpGapRow } from "@/types/crm-reports"
import type { ListResponse } from "@/types/api"

function Pager({ page, data, loading, setPage }: { page: number; data: { total: number; totalPages: number } | null; loading: boolean; setPage: (page: number) => void }) { return <CrmPagination page={page} pageSize={10} total={data?.total ?? 0} totalPages={data?.totalPages} loading={loading} onPageChange={setPage} /> }
export function ActivityOverview() {
  const [data, setData] = React.useState<Overview | null>(null)
  const [staff, setStaff] = React.useState<ListResponse<StaffActivityRow> | null>(null)
  const [gaps, setGaps] = React.useState<ListResponse<FollowUpGapRow> | null>(null)
  const [scope, setScope] = React.useState("mine")
  const [owner, setOwner] = React.useState("")
  const [type, setType] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [through, setThrough] = React.useState("")
  const [period, setPeriod] = React.useState<{ from: string; through: string } | null>(null)
  const [periodOpen, setPeriodOpen] = React.useState(false)
  const [staffPage, setStaffPage] = React.useState(1)
  const [gapPage, setGapPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { formatDate } = useDateFormatter()
  const reset = () => { setStaffPage(1); setGapPage(1) }
  const params = new URLSearchParams({ scope, ...(period || {}), ...(owner ? { assignedUserId: owner } : {}), ...activityTypeFilter(type) }).toString()
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError("")
      const get = async (path: string) => { const response = await fetch(`/api/crm/reports/${path}`, { signal: controller.signal, cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to load activity report."); return result }
      try {
        const [overview, people, missing] = await Promise.all([get(`activities?${params}`), get(`staff?${params}&page=${staffPage}&pageSize=10`), get(`follow-up-gaps?${params}&page=${gapPage}&pageSize=10`)])
        if (!controller.signal.aborted) { setData(overview); setStaff(people); setGaps(missing); if (!period) { setFrom(overview.from); setThrough(overview.through) } }
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setStaff(null); setGaps(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 100)
    return () => { clearTimeout(timer); controller.abort() }
  }, [params, period, staffPage, gapPage, revision])
  const workLink = (kind: "open" | "overdue" | "today" | "completed", assignedUserId = owner) => `/crm/activities?${new URLSearchParams({ scope: scope === "team" ? "visible" : "mine", state: kind === "completed" ? "completed" : "open", ...(assignedUserId ? { assignedUserId } : {}), ...activityTypeFilter(type), ...(kind === "completed" && data ? { completedFrom: data.from, completedThrough: data.through } : kind !== "open" ? { due: kind } : {}) })}`
  return <section className={crmPageClass}>
    <CrmPageHeader title="Activity overview" description="Current workload, completed activities and follow-up gaps." actions={<Button asChild><Link href="/crm/activities/new">Schedule activity</Link></Button>} />
    <CrmSurface className="p-3 sm:p-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Overview filters">
        <CrmSelect id="report-scope" aria-label="Scope" className={selectClass} value={scope} onValueChange={value => { setScope(value); setOwner(""); reset() }}><option value="mine">My work</option>{data?.canManage && <option value="team">Team</option>}</CrmSelect>
        <div className="min-w-0 w-60"><label htmlFor="report-type" className="sr-only">Activity type</label><ActivityTypeSelect id="report-type" filter value={type} onChange={value => { setType(value); reset() }} /></div>
        {scope === "team" && <div className="min-w-0 basis-full sm:basis-48"><label htmlFor="report-owner" className="sr-only">Assigned staff</label><RecordSelect id="report-owner" placeholder="All staff" endpoint="/api/crm/assignees" value={owner} onChange={value => { setOwner(value); reset() }} /></div>}
        <Popover open={periodOpen} onOpenChange={open => { setPeriodOpen(open); if (open && data) { setFrom(data.from); setThrough(data.through) } }}>
          <PopoverTrigger asChild><Button type="button" variant="outline" aria-label="Completion period" disabled={!data} className="min-w-0 basis-full justify-between font-normal sm:basis-auto"><CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{data ? `${formatDate(data.from)} â€“ ${formatDate(data.through)}` : "Completion period"}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent align="start" collisionPadding={16} className="w-[min(24rem,calc(100vw-2rem))] space-y-4 p-4" aria-label="Completion period">
            <div><h2 className="font-semibold">Completion period</h2><p className="mt-1 text-sm text-muted-foreground">Choose which completed activities to include.</p></div>
            <form className="space-y-4 [color-scheme:light] dark:[color-scheme:dark]" onSubmit={event => { event.preventDefault(); setPeriod({ from, through }); reset(); setPeriodOpen(false) }}>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2"><FormField id="report-from" label="From" className="min-w-0"><Input id="report-from" type="date" required value={from} onChange={event => setFrom(event.target.value)} /></FormField><FormField id="report-through" label="Through (inclusive)" className="min-w-0"><Input id="report-through" type="date" required min={from} value={through} onChange={event => setThrough(event.target.value)} /></FormField></div>
              <div className="flex justify-end gap-2 border-t pt-3"><Button type="button" variant="outline" onClick={() => setPeriodOpen(false)}>Cancel</Button><Button type="submit" disabled={loading || !from || !through}>Apply period</Button></div>
            </form>
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex items-center gap-1"><Button variant="ghost" size="sm" disabled={loading} onClick={() => { setOwner(""); setType(""); setPeriod(null); reset(); setRevision(value => value + 1) }}>Reset filters</Button><span className="mx-1 h-5 w-px bg-border" aria-hidden="true" /><Button variant="ghost" size="icon" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" aria-hidden="true" /></Button></div>
      </div>
    </CrmSurface>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading && <p role="status">Loading activity reportâ€¦</p>}
    {!loading && !error && data && <>
      <p className="text-sm text-muted-foreground">Current workload is shown regardless of period. Completions use the date work was marked complete or logged, from {formatDate(data.from)} through {formatDate(data.through)} in {data.timeZone}, credited to the assigned staff member.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([
        ["Open activities", data.totals.open, workLink("open")], ["Overdue", data.totals.overdue, workLink("overdue")], ["Due today", data.totals.dueToday, workLink("today")], ["Completed in period", data.totals.completed, workLink("completed")], ["Deals with no open activity", data.totals.withoutActivity, "#follow-up-gaps"],
      ] as const).map(([label, count, href]) => <Link key={label} href={href} className="rounded-xl border bg-card p-4 shadow-sm hover:bg-muted"><p className="text-sm">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{count}</p></Link>)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><CrmSection title={<>Activities by type</>}> <table className="w-full text-left text-sm"><thead><tr><th className="py-2">Type</th><th>Open now</th><th>Completed in period</th></tr></thead><tbody>{data.byType.map(row => <tr key={row.type} className="border-t"><th className="py-3 font-normal">{data.activityTypeName || row.type}</th><td>{row.open}</td><td>{row.completed}</td></tr>)}</tbody></table></CrmSection>
      <CrmSection title={<>Call outcomes in period</>}> {data.callOutcomes.length ? data.callOutcomes.map(row => <div key={row.outcome} className="flex justify-between gap-3 border-b py-2 text-sm"><span>{row.outcome.replaceAll("_", " ")}</span><strong>{row.count}</strong></div>) : <p className="text-sm text-muted-foreground">No completed calls in this selection.</p>}</CrmSection></div>
      <CrmSection title={<>{scope === "team" ? "Staff workload" : "My workload"}</>}> <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Staff</th><th className="p-3">Open</th><th className="p-3">Overdue</th><th className="p-3">Due today</th><th className="p-3">Completed in period</th></tr></thead><tbody>{staff?.items.map(row => <tr key={row.id} className="border-t"><th className="p-3 font-normal">{row.name || "Unnamed staff"}{row.status !== "ACTIVE" && <span className="ml-2 text-muted-foreground">({row.status})</span>}</th>{(["open", "overdue", "today", "completed"] as const).map(kind => <td key={kind} className="p-3"><Link className="underline" href={workLink(kind, row.id)}>{row[kind === "today" ? "dueToday" : kind]}</Link></td>)}</tr>)}</tbody></table></div>{staff?.total === 0 && <p>No staff match this selection.</p>}<Pager page={staffPage} data={staff} loading={loading} setPage={setStaffPage} /></CrmSection>
      <CrmSection id="follow-up-gaps" title={<>Open opportunities with no open activity</>}> <p className="text-sm text-muted-foreground">Uses the selected deal owner, across all activity types and dates. Archived pipelines, stages and customers are excluded. An activity must be linked directly to the opportunity; overdue open work still counts as assigned.</p>
        {gaps?.items.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium underline" href={`/crm/opportunities/${row.id}`}>{row.title}</Link><p className="text-sm">{row.contact.name} Â· {row.assignee.name || "Unnamed staff"}</p><p className="text-xs text-muted-foreground">{row.pipeline.name} / {row.stage.name} Â· Expected close {formatDate(row.expectedCloseOn.slice(0, 10))}</p></div><Button variant="outline" asChild><Link href={`/crm/activities/new?opportunityId=${encodeURIComponent(row.id)}`}>Schedule follow-up</Link></Button></article>)}
        {gaps?.total === 0 && <p className="text-sm text-muted-foreground">No follow-up gaps in this selection.</p>}<Pager page={gapPage} data={gaps} loading={loading} setPage={setGapPage} />
      </CrmSection>
    </>}
  </section>
}
