"use client"
import { CrmPagination } from "./crm-pagination"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmSurface, crmPageClass } from "./crm-page"
import { CrmSelect } from "./crm-controls"
import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { workTypes } from "../work-validation"
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
  const [staffPage, setStaffPage] = React.useState(1)
  const [gapPage, setGapPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const { formatDate } = useDateFormatter()
  const reset = () => { setStaffPage(1); setGapPage(1) }
  const params = new URLSearchParams({ scope, ...(period || {}), ...(owner ? { assignedUserId: owner } : {}), ...(type ? { type } : {}) }).toString()
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
  const workLink = (kind: "open" | "overdue" | "today" | "completed", assignedUserId = owner) => `/crm/activities?${new URLSearchParams({ scope: scope === "team" ? "visible" : "mine", state: kind === "completed" ? "completed" : "open", ...(assignedUserId ? { assignedUserId } : {}), ...(type ? { type } : {}), ...(kind === "completed" && data ? { completedFrom: data.from, completedThrough: data.through } : kind !== "open" ? { due: kind } : {}) })}`
  return <section className={crmPageClass}>
    <CrmPageHeader title="Activity overview" description="Current workload, completed activities and follow-up gaps." actions={<Button asChild><Link href="/crm/activities/new">Schedule activity</Link></Button>} />
    <CrmSurface><div className="flex flex-wrap items-end gap-3">
      <FormField id="report-scope" label="Scope"><CrmSelect id="report-scope" className={selectClass} value={scope} onValueChange={event => { setScope(event); setOwner(""); reset() }}><option value="mine">My work</option>{data?.canManage && <option value="team">Team</option>}</CrmSelect></FormField>
      {scope === "team" && <FormField id="report-owner" label="Assigned staff"><div className="w-56"><RecordSelect id="report-owner" endpoint="/api/crm/assignees" value={owner} onChange={value => { setOwner(value); reset() }} /></div></FormField>}
      <FormField id="report-type" label="Activity type"><CrmSelect id="report-type" className={selectClass} value={type} onValueChange={event => { setType(event); reset() }}><option value="">All types</option>{workTypes.map(value => <option key={value}>{value}</option>)}</CrmSelect></FormField>
      <Button variant="outline" disabled={loading} onClick={() => { setOwner(""); setType(""); setPeriod(null); reset(); setRevision(value => value + 1) }}>Reset filters</Button>
      <Button variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</Button>
    </div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setPeriod({ from, through }); reset() }}><FormField id="report-from" label="Completions from"><Input id="report-from" type="date" required value={from} onChange={event => setFrom(event.target.value)} /></FormField><FormField id="report-through" label="Through (inclusive)"><Input id="report-through" type="date" required min={from} value={through} onChange={event => setThrough(event.target.value)} /></FormField><Button type="submit" variant="outline" disabled={loading || !from || !through}>Apply period</Button></form></CrmSurface>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading && <p role="status">Loading activity report…</p>}
    {!loading && !error && data && <>
      <p className="text-sm text-muted-foreground">Current workload is shown regardless of period. Completions use the date work was marked complete or logged, from {formatDate(data.from)} through {formatDate(data.through)} in {data.timeZone}, credited to the assigned staff member.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([
        ["Open activities", data.totals.open, workLink("open")], ["Overdue", data.totals.overdue, workLink("overdue")], ["Due today", data.totals.dueToday, workLink("today")], ["Completed in period", data.totals.completed, workLink("completed")], ["Deals with no open activity", data.totals.withoutActivity, "#follow-up-gaps"],
      ] as const).map(([label, count, href]) => <Link key={label} href={href} className="rounded-xl border bg-card p-4 shadow-sm hover:bg-muted"><p className="text-sm">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{count}</p></Link>)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><CrmSection title={<>Activities by type</>}> <table className="w-full text-left text-sm"><thead><tr><th className="py-2">Type</th><th>Open now</th><th>Completed in period</th></tr></thead><tbody>{data.byType.map(row => <tr key={row.type} className="border-t"><th className="py-3 font-normal">{row.type}</th><td>{row.open}</td><td>{row.completed}</td></tr>)}</tbody></table></CrmSection>
      <CrmSection title={<>Call outcomes in period</>}> {data.callOutcomes.length ? data.callOutcomes.map(row => <div key={row.outcome} className="flex justify-between gap-3 border-b py-2 text-sm"><span>{row.outcome.replaceAll("_", " ")}</span><strong>{row.count}</strong></div>) : <p className="text-sm text-muted-foreground">No completed calls in this selection.</p>}</CrmSection></div>
      <CrmSection title={<>{scope === "team" ? "Staff workload" : "My workload"}</>}> <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Staff</th><th className="p-3">Open</th><th className="p-3">Overdue</th><th className="p-3">Due today</th><th className="p-3">Completed in period</th></tr></thead><tbody>{staff?.items.map(row => <tr key={row.id} className="border-t"><th className="p-3 font-normal">{row.name || "Unnamed staff"}{row.status !== "ACTIVE" && <span className="ml-2 text-muted-foreground">({row.status})</span>}</th>{(["open", "overdue", "today", "completed"] as const).map(kind => <td key={kind} className="p-3"><Link className="underline" href={workLink(kind, row.id)}>{row[kind === "today" ? "dueToday" : kind]}</Link></td>)}</tr>)}</tbody></table></div>{staff?.total === 0 && <p>No staff match this selection.</p>}<Pager page={staffPage} data={staff} loading={loading} setPage={setStaffPage} /></CrmSection>
      <CrmSection id="follow-up-gaps" title={<>Open opportunities with no open activity</>}> <p className="text-sm text-muted-foreground">Uses the selected deal owner, across all activity types and dates. Archived pipelines, stages and customers are excluded. An activity must be linked directly to the opportunity; overdue open work still counts as assigned.</p>
        {gaps?.items.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium underline" href={`/crm/opportunities/${row.id}`}>{row.title}</Link><p className="text-sm">{row.contact.name} · {row.assignee.name || "Unnamed staff"}</p><p className="text-xs text-muted-foreground">{row.pipeline.name} / {row.stage.name} · Expected close {formatDate(row.expectedCloseOn.slice(0, 10))}</p></div><Button variant="outline" asChild><Link href={`/crm/activities/new?opportunityId=${encodeURIComponent(row.id)}`}>Schedule follow-up</Link></Button></article>)}
        {gaps?.total === 0 && <p className="text-sm text-muted-foreground">No follow-up gaps in this selection.</p>}<Pager page={gapPage} data={gaps} loading={loading} setPage={setGapPage} />
      </CrmSection>
    </>}
  </section>
}
