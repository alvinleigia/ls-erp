"use client"
import * as React from "react"
import Link from "@/platform/access/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/erp/controls"
import { Section } from "@/components/erp/section"
import { Pagination } from "@/components/erp/pagination"
import { ExportButton } from "@/components/erp/export-button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import type { ListResponse } from "@/types/api"
import { teamMetrics, teamMetricKeys, teamMetricLabel, type TeamMetric, type TeamPerformanceResponse, type TeamPerformanceRecord } from "../team-performance-contract"
import { useTerminology } from "@/platform/terminology/provider"

function useTeamReport<T>(path: string, params: string, revision: number) {
  const key = `${path}?${params}&${revision}`
  const [state, setState] = React.useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" })
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/crm/reports/sales/team${path}?${params}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw Error(data.error || "Unable to load team performance.")
        if (!controller.signal.aborted) setState({ key, data, error: "" })
      } catch (error) { if (!controller.signal.aborted) setState({ key, data: null, error: (error as Error).message }) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, path, params])
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : "", loading: state.key !== key }
}

function PerformanceRecords({ params, metric, caption, revision, onClose }: { params: string; metric: TeamMetric; caption: string; revision: number; onClose: () => void }) {
  const term = useTerminology()
  const [page, setPage] = React.useState(1)
  const { data, error, loading } = useTeamReport<ListResponse<TeamPerformanceRecord>>("/records", `${params}&metric=${metric}&page=${page}&pageSize=20`, revision)
  return <Section id="team-performance-records" title={`${caption}: ${teamMetricLabel(term, metric)}`} description="These records use the same filters and date basis as the selected count." actions={<Button variant="outline" onClick={onClose}>Close records</Button>}>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Assigned user</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
      {data?.items.map(row => <TableRow key={row.id}><TableCell><Link className="underline" href={`/crm/${row.kind}/${row.id}`}>{row.title}</Link></TableCell><TableCell>{row.owner}</TableCell><TableCell>{row.status === "CLOSED" ? "Lost" : row.status.replaceAll("_", " ")}</TableCell></TableRow>)}
      {!data?.items.length && <TableRow><TableCell colSpan={3}>{loading ? "Loading records…" : error ? "Records unavailable." : "No matching records."}</TableCell></TableRow>}
    </TableBody></Table><Pagination page={page} pageSize={20} total={data?.total ?? 0} totalPages={data?.totalPages} loading={loading} onPageChange={setPage} />
  </Section>
}

export function TeamPerformance({ params, revision, formatMoney }: { params: string; revision: number; formatMoney: (amount: string, currency: string) => string }) {
  const term = useTerminology()
  const [page, setPage] = React.useState(1), [size, setSize] = React.useState(20), [search, setSearch] = React.useState("")
  const [group, setGroup] = React.useState("summary"), [sort, setSort] = React.useState<string>("name"), [order, setOrder] = React.useState("asc")
  const [selection, setSelection] = React.useState<{ metric: TeamMetric; userId?: string; caption: string } | null>(null)
  const base = `${params}&q=${encodeURIComponent(search)}&sort=${sort}&order=${order}`
  const { data, error, loading } = useTeamReport<TeamPerformanceResponse>("", `${base}&page=${page}&pageSize=${size}`, revision)
  const metrics = group === "summary" ? ["enquiries", "converted", "pipeline", "won", "lost", "activitiesOverdue", "activitiesCompleted", "callsCompleted"] as TeamMetric[] : teamMetricKeys.filter(key => teamMetrics[key].group === group)
  const showConversion = group === "summary" || group === "enquiries", showValues = group === "summary" || group === "opportunities"
  function changeSort(key: string) { setSort(key); setOrder(sort === key && order === "asc" ? "desc" : "asc"); setPage(1) }
  function select(metric: TeamMetric, caption: string, userId?: string) { setSelection({ metric, caption, userId }); setTimeout(() => document.getElementById("team-performance-records")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0) }
  const number = (metric: TeamMetric, value: number, caption: string, userId?: string) => <Button type="button" variant="link" className="h-auto p-0 tabular-nums" disabled={loading || value === 0} aria-label={`${caption}: ${teamMetricLabel(term, metric)}, ${value}`} onClick={() => select(metric, caption, userId)}>{value}</Button>
  const pipeline = (values: { currency: string; amount: string }[]) => values.length ? values.map(v => <p key={v.currency} className="whitespace-nowrap tabular-nums">{formatMoney(v.amount, v.currency)}</p>) : "—"
  return <div className="min-w-0 space-y-5">
    <Section title="Team performance" description="Compare members side by side. Click a count to open its records." actions={<ExportButton requirement={["reports.export", "enquiries.export", "opportunities.export", "activities.export"]} href={`/api/crm/reports/sales/team/export?${base}`} filename="team-performance.csv" disabled={loading || !!error || !data?.total} />}>
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 basis-full text-sm sm:basis-0 sm:flex-1">Find team member<Input className="mt-1" placeholder="Search members…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); setSelection(null) }} /></label><label className="flex min-w-0 basis-full flex-col text-sm sm:basis-auto">Compare<Select aria-label="Performance columns" className="mt-1 w-full" value={group} onValueChange={setGroup}><option value="summary">Summary</option><option value="enquiries">Enquiry statuses</option><option value="opportunities">Opportunities</option><option value="activities">Activity statuses</option><option value="calls">Call outcomes</option></Select></label></div>
      {data && <p className="text-sm font-medium">Sales team: {data.team?.name || "All accessible teams"}{data.team?.archived ? " (archived)" : ""}</p>}
      <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">How these figures are calculated</summary><div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">{data ? `${data.from} through ${data.through}, inclusive · ${data.timeZone}. ` : ""}Enquiries use creation dates and their current status; converted is an overlapping measure. Won/lost opportunities use closing dates. Completed work uses completion dates, credited to the current assignee. Open pipeline, pending work and overdue counts are current across all dates. Cancelled work uses its creation period.</p>
      {data && <p className="text-sm text-muted-foreground">{data.canReadRoster ? "Visible members with zero work are included. Former or non-member owners remain listed when they have matching records." : "Team membership is not readable. Only owners of matching readable records are included; a full zero-work roster is unavailable."} Totals include all matching pages. Search narrows rows and totals. CSV includes every metric group and respects export access.</p>}
      <p>Counts include only records you can read. Team filtering uses the saved team on each record. Activities are credited to their own assignee, independently of the salesperson on the related record.</p>
      </div></details>
      {data && !data.canReadRoster && <p role="status" className="text-sm text-muted-foreground">Team membership is not readable. Showing owners of matching records; zero-work members are unavailable.</p>}
      {error && <p role="alert" className="text-destructive">{error} Use Refresh to retry.</p>}
      <div className="max-w-full overflow-x-auto [&>div]:overflow-visible" role="region" aria-label="Team member performance comparison" tabIndex={0}><Table><TableHeader><TableRow>
        <TableHead className="sticky left-0 z-10 bg-card" aria-sort={sort === "name" ? order === "asc" ? "ascending" : "descending" : "none"}><Button variant="ghost" className="px-0" onClick={() => changeSort("name")}>Team member {sort === "name" ? order === "asc" ? "↑" : "↓" : ""}</Button></TableHead>
        {metrics.map(metric => <TableHead key={metric} className="min-w-28 whitespace-normal" aria-sort={sort === metric ? order === "asc" ? "ascending" : "descending" : "none"}><Button variant="ghost" className="h-auto whitespace-normal px-0 text-left" onClick={() => changeSort(metric)}>{teamMetricLabel(term, metric)} {sort === metric ? order === "asc" ? "↑" : "↓" : ""}</Button></TableHead>)}
        {showConversion && <TableHead><Button variant="ghost" className="px-0" onClick={() => changeSort("conversionPercent")}>Conversion %</Button></TableHead>}{showValues && <TableHead>Open pipeline value</TableHead>}
      </TableRow></TableHeader><TableBody>
        {!loading && data?.items.map(row => <TableRow key={row.id}><TableCell className="sticky left-0 z-10 min-w-44 bg-card"><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.userType === "external" ? "External collaborator" : "Internal user"}{row.isMember ? " · Member" : " · Record owner"}{row.status !== "ACTIVE" ? ` · ${row.status.toLowerCase()}` : ""}</p></TableCell>{metrics.map(metric => <TableCell key={metric}>{number(metric, row[metric], row.name, row.id)}</TableCell>)}{showConversion && <TableCell className="tabular-nums">{row.conversionPercent === null ? "—" : `${row.conversionPercent}%`}</TableCell>}{showValues && <TableCell>{pipeline(row.pipelineValues)}</TableCell>}</TableRow>)}
        {!data?.items.length && <TableRow><TableCell colSpan={1 + metrics.length + Number(showConversion) + Number(showValues)}>{loading ? "Loading team performance…" : error ? "Team performance unavailable." : "No members or records match this selection."}</TableCell></TableRow>}
        {data && <TableRow className="bg-muted/40 font-semibold"><TableCell className="sticky left-0 z-10 bg-card">Team total · {data.total} {data.total === 1 ? "user" : "users"}</TableCell>{metrics.map(metric => <TableCell key={metric}>{number(metric, data.totals[metric], "Team total")}</TableCell>)}{showConversion && <TableCell>{data.totals.conversionPercent === null ? "—" : `${data.totals.conversionPercent}%`}</TableCell>}{showValues && <TableCell>{pipeline(data.totals.pipelineValues)}</TableCell>}</TableRow>}
      </TableBody></Table></div>
      <Pagination page={page} pageSize={size} total={data?.total ?? 0} totalPages={data?.totalPages} loading={loading} onPageChange={setPage} onPageSizeChange={value => { setSize(value); setPage(1) }} />
    </Section>
    {selection && !loading && !error && <PerformanceRecords key={`${base}:${selection.metric}:${selection.userId || "all"}`} params={`${base}${selection.userId ? `&assignedUserId=${encodeURIComponent(selection.userId)}` : ""}`} metric={selection.metric} caption={selection.caption} revision={revision} onClose={() => setSelection(null)} />}
  </div>
}
