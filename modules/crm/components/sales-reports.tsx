"use client"
import { AttributionFilters, emptyAttributionFilters } from "@/platform/collaborators/report-controls"
import { attributionQuery, type AttributionFilter } from "@/platform/collaborators/report-validation"
import { useTerminology } from "@/platform/terminology/provider"
import { salesReportLabels, reportLabel, reportBucketLabel } from "../report-labels"
import { SalesTeamSelect } from "@/platform/teams/controls"
import { LostReasonFilter } from "./lost-reason-fields"
import * as React from "react"
import Link from "@/platform/access/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import { FormField } from "@/components/form-field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { AccessPageHeader } from "@/platform/access/record-page"
import { Surface, Filters, pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { Select } from "@/components/erp/controls"
import { Pagination } from "@/components/erp/pagination"
import { RecordSelect } from "@/components/erp/record-select"
import { ExportButton } from "@/components/erp/export-button"
import { CrmExtensionFilter, useCrmExtensionFilterQuery } from "./extension-provider"
import type { ListResponse } from "@/types/api"
import type { SalesReportSummary, SalesReportView, SalesReportDimension, SalesReportRecord, SalesLeadGroup, SalesValueGroup } from "@/types/crm-sales-report"

type SelectReport = (view: SalesReportView, extra?: Record<string, string>, caption?: string) => void
type MoneyFormatter = (amount: string, currency: string) => string

function useReport<T>(path: string, params: string, revision: number) {
  const [state, setState] = React.useState<{ data: T | null; error: string; key: string }>({ data: null, error: "", key: "" })
  const key = `${path}?${params}&revision=${revision}`
  React.useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(`/api/crm/reports/sales${path}?${params}`, { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load sales report.")
        if (!controller.signal.aborted) setState({ data, error: "", key })
      } catch (error) { if (!controller.signal.aborted) setState({ data: null, error: (error as Error).message, key }) }
    }
    void load()
    return () => controller.abort()
  }, [path, params, key])
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : "", loading: state.key !== key }
}
function ReportError({ error }: { error: string }) { return error ? <p role="alert" className="text-sm text-destructive">{error} Use Refresh to retry.</p> : null }
function Pager({ data, page, size, loading, setPage, setSize }: { data: { total: number; totalPages: number } | null; page: number; size: number; loading: boolean; setPage: (p: number) => void; setSize: (n: number) => void }) {
  return <Pagination page={page} pageSize={size} total={data?.total || 0} totalPages={data?.totalPages} loading={loading} onPageChange={setPage} onPageSizeChange={n => { setSize(n); setPage(1) }} />
}
function LeadBreakdown({ params, revision, dimensions, onSelect }: { params: string; revision: number; dimensions: SalesReportSummary["dimensions"]; onSelect: SelectReport }) {
  const term = useTerminology()
  const [dimension, setDimension] = React.useState<SalesReportDimension>("source"), [page, setPage] = React.useState(1), [size, setSize] = React.useState(10)
  const { data, loading, error } = useReport<ListResponse<SalesLeadGroup>>("/breakdown", `${params}&dimension=${dimension}&page=${page}&pageSize=${size}`, revision)
  const group = dimensions.find(item => item.key === dimension)
  const bucketLabel = (row: SalesLeadGroup) => reportBucketLabel(term, group, row.id, row.label)
  return <Section title={term("crm.enquiry.singular", "Lead conversion", "{label} conversion")} description={`Of the ${term("crm.enquiry.plural", "leads")} created in the selected period, how many now have ${term("crm.opportunity.singular", "an opportunity", "a linked {label}")} you can access. Each ${term("crm.enquiry.singular", "lead")} is counted once. Grouping by lost reason shows only lost ${term("crm.enquiry.plural", "enquiries")}; older closures without a reason stay unclassified.`} actions={<Select aria-label={term("crm.enquiry.plural", "Group leads by", "Group {label} by")} value={dimension} onValueChange={v => { setDimension(v as SalesReportDimension); setPage(1) }}>{dimensions.map(item => <option key={item.key} value={item.key}>{item.key === "lostReason" ? term("crm.enquiry.plural", "Lost enquiries by reason", "Lost {label} by reason") : reportLabel(term, item, true)}</option>)}</Select>}>
    <ReportError error={error} />
    <Table><TableHeader><TableRow><TableHead>{group ? reportLabel(term, group) : "Group"}</TableHead><TableHead>{term("crm.enquiry.plural", "Leads")}</TableHead><TableHead>Converted</TableHead><TableHead>Conversion</TableHead></TableRow></TableHeader><TableBody>
      {!loading && data?.items.map(r => <TableRow key={r.id}><TableCell>{bucketLabel(r)}</TableCell><TableCell><Button variant="link" className="h-auto p-0" onClick={() => onSelect("leads", { dimension, bucket: r.id }, r.label)}>{r.leads}</Button></TableCell><TableCell><Button variant="link" className="h-auto p-0" onClick={() => onSelect("converted", { dimension, bucket: r.id }, r.label)}>{r.converted}</Button></TableCell><TableCell>{r.leads ? (100 * r.converted / r.leads).toFixed(1) : "0.0"}%</TableCell></TableRow>)}
      {(loading || !data?.items.length) && <TableRow><TableCell colSpan={4}>{loading ? "Loading…" : term("crm.enquiry.plural", "No leads in this selection.", "No {label} in this selection.")}</TableCell></TableRow>}
    </TableBody></Table><Pager data={data} page={page} size={size} loading={loading} setPage={setPage} setSize={setSize} />
  </Section>
}
function DealValues({ params, revision, onSelect, formatMoney }: { params: string; revision: number; onSelect: SelectReport; formatMoney: MoneyFormatter }) {
  const term = useTerminology()
  const [view, setView] = React.useState("pipeline"), [page, setPage] = React.useState(1), [size, setSize] = React.useState(10)
  const { data, loading, error } = useReport<ListResponse<SalesValueGroup>>("/values", `${params}&view=${view}&page=${page}&pageSize=${size}`, revision)
  return <Section title={term("crm.opportunity.singular", "Deal values by stage", "{label} values by stage")} description={term("crm.opportunity.singular", "Values are separate for each currency. Open pipeline is current; won and lost use the closing date in the selected period. These are deal values, not payments received.", "Values are separate for each currency. Open pipeline is current; won and lost use the closing date in the selected period. These are {label} values, not payments received.")} actions={<Select aria-label={term("crm.opportunity.singular", "Deal value report", "{label} value report")} value={view} onValueChange={v => { setView(v); setPage(1) }}><option value="pipeline">Current pipeline</option><option value="won">Won in period</option><option value="lost">Lost in period</option></Select>}>
    <ReportError error={error} /><Table><TableHeader><TableRow><TableHead>Pipeline / stage</TableHead><TableHead>{term("crm.opportunity.plural", "Deals")}</TableHead><TableHead>Currency</TableHead><TableHead>{term("crm.opportunity.singular", "Deal value", "{label} value")}</TableHead></TableRow></TableHeader><TableBody>
      {!loading && data?.items.map(r => <TableRow key={`${r.stageId}:${r.currency}`}><TableCell><p className="font-medium">{r.stage}</p><p className="text-xs text-muted-foreground">{r.pipeline}</p></TableCell><TableCell><Button variant="link" className="h-auto p-0" onClick={() => onSelect(view as SalesReportView, { stageId: r.stageId, currency: r.currency }, `${r.pipeline} / ${r.stage} / ${r.currency}`)}>{r.count}</Button></TableCell><TableCell>{r.currency}</TableCell><TableCell className="tabular-nums">{formatMoney(r.amount, r.currency)}</TableCell></TableRow>)}
      {(loading || !data?.items.length) && <TableRow><TableCell colSpan={4}>{loading ? "Loading…" : term("crm.opportunity.plural", "No deals in this selection.", "No {label} in this selection.")}</TableCell></TableRow>}
    </TableBody></Table><Pager data={data} page={page} size={size} loading={loading} setPage={setPage} setSize={setSize} />
  </Section>
}
function ReportRecords({ params, view, revision, columns, formatMoney, caption }: { params: string; view: SalesReportView; revision: number; columns: SalesReportSummary["extensionColumns"]; formatMoney: MoneyFormatter; caption?: string }) {
  const term = useTerminology()
  const { formatDate } = useDateFormatter()
  const [page, setPage] = React.useState(1), [size, setSize] = React.useState(20)
  const { data, loading, error } = useReport<ListResponse<SalesReportRecord>>("/records", `${params}&page=${page}&pageSize=${size}`, revision)
  return <Section title={salesReportLabels(term)[view]} description={`${caption ? `Selected: ${caption}. ` : ""}These records match the selected metric or breakdown. Export includes all matching pages, up to 2,000 rows.`} actions={<ExportButton requirement={["reports.export", view === "leads" || view === "converted" ? "enquiries.export" : view === "overdue" ? "activities.export" : "opportunities.export"]} href={`/api/crm/reports/sales/export?${params}`} filename={`sales-${view}.csv`} disabled={loading || !!error || !data?.total} />}>
    <ReportError error={error} /><Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>{term("crm.contact.singular", "Customer")}</TableHead><TableHead>Assigned user</TableHead><TableHead>Introducing collaborator</TableHead><TableHead>Supervisor at introduction</TableHead><TableHead>Status</TableHead><TableHead>Lost reason</TableHead>{columns.map(column => <TableHead key={column.key}>{reportLabel(term, column)}</TableHead>)}<TableHead>{view === "overdue" ? "Due date" : term("crm.opportunity.singular", "Deal value", "{label} value")}</TableHead></TableRow></TableHeader><TableBody>
      {!loading && data?.items.map(r => <TableRow key={r.id}><TableCell><Link className="font-medium underline" href={`/crm/${r.recordKind}/${r.id}`}>{r.title}</Link></TableCell><TableCell>{r.customer}</TableCell><TableCell>{r.owner}</TableCell><TableCell>{r.partnerName ? `${r.partnerName} (${r.partnerCode})` : "No recorded introducing partner"}</TableCell><TableCell>{r.introductionSupervisorName || (r.partnerName ? "Former supervisor" : "?")}</TableCell><TableCell>{r.status === "CLOSED" ? "Lost" : r.status}</TableCell><TableCell>{r.lostReasonName || "—"}</TableCell>{columns.map(column => <TableCell key={column.key}>{r.extensionValues[column.key] || "—"}</TableCell>)}<TableCell>{view === "overdue" ? formatDate(r.dueOn) : r.amount && r.currency ? formatMoney(r.amount, r.currency) : "—"}</TableCell></TableRow>)}
      {(loading || !data?.items.length) && <TableRow><TableCell colSpan={8 + columns.length}>{loading ? "Loading…" : "No records in this selection."}</TableCell></TableRow>}
    </TableBody></Table><Pager data={data} page={page} size={size} loading={loading} setPage={setPage} setSize={setSize} />
  </Section>
}
export function SalesReports() {
  const term = useTerminology()
  const labels = salesReportLabels(term)
  const { formatDate } = useDateFormatter()
  const [moneySettings, setMoneySettings] = React.useState<AppSettingsPayload | undefined>()
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/settings/display", { signal: controller.signal, cache: "no-store" }).then(async response => { if (response.ok) setMoneySettings((await response.json()).settings) }).catch(() => {})
    return () => controller.abort()
  }, [])
  const formatMoney = (amount: string, currency: string) => formatDecimalCurrency(amount, currency, moneySettings)
  const [scope, setScope] = React.useState("mine"), [owner, setOwner] = React.useState(""), [source, setSource] = React.useState("")
  const [lostReasonId, setLostReasonId] = React.useState("")
  const [primaryId, setPrimaryId] = React.useState(""), [secondaryId, setSecondaryId] = React.useState("")
  const [period, setPeriod] = React.useState<{ from: string; through: string } | null>(null), [from, setFrom] = React.useState(""), [through, setThrough] = React.useState("")
  const [periodOpen, setPeriodOpen] = React.useState(false), [periodError, setPeriodError] = React.useState(""), [revision, setRevision] = React.useState(0)
  const [selection, setSelection] = React.useState<{ base: string; view: SalesReportView; extra: Record<string, string>; caption?: string } | null>(null)
  const [attribution, setAttribution] = React.useState<AttributionFilter>(emptyAttributionFilters)
  const [salesTeamId, setSalesTeamId] = React.useState("")
  const extensionQuery = useCrmExtensionFilterQuery(primaryId, secondaryId)
  const params = new URLSearchParams({ ...attributionQuery(attribution), ...(salesTeamId ? { salesTeamId } : {}), scope, ...(lostReasonId ? { lostReasonId } : {}), ...(period || {}), ...(owner ? { assignedUserId: owner } : {}), ...(source ? { sourceId: source } : {}), ...extensionQuery }).toString()
  const { data, loading, error } = useReport<SalesReportSummary>("", params, revision)
  const selected = selection?.base === params ? selection : { view: "leads" as const, extra: {} }
  const details = `${params}&${new URLSearchParams({ view: selected.view, ...selected.extra })}`
  const select: SelectReport = (view, extra = {}, caption) => { setSelection({ base: params, view, extra, caption }); document.getElementById("sales-records")?.scrollIntoView({ behavior: "smooth", block: "start" }) }
  const reset = () => { setAttribution(emptyAttributionFilters); setLostReasonId(""); setOwner(""); setSource(""); setPrimaryId(""); setSecondaryId(""); setPeriod(null) }
  function applyPeriod() {
    if (!from || !through || through < from || Date.parse(through) - Date.parse(from) > 365 * 86400000) { setPeriodError("Choose both dates, covering at most 366 days."); return }
    setPeriod({ from, through }); setPeriodError(""); setPeriodOpen(false)
  }
  return <section className={pageClass}>
    <AccessPageHeader title="Sales reports" description={term("crm.enquiry.singular", "Track lead conversion, pipeline value and follow-up coverage.", "Track {label} conversion, pipeline value and follow-up coverage.")} actions={<Button variant="outline" asChild><Link href="/crm/overview">{term("crm.activity.singular", "Activity overview", "{label} overview")}</Link></Button>} />
    <Surface><div className="flex flex-wrap items-end gap-3">
      <FormField id="sales-scope" label="Scope"><Select id="sales-scope" value={scope} onValueChange={v => { setScope(v); setOwner("") }}><option value="mine">My sales</option>{data?.canManage && <option value="team">Team sales</option>}</Select></FormField>
      <Popover open={periodOpen} onOpenChange={open => { setPeriodOpen(open); if (open) { setFrom(period?.from || data?.from || ""); setThrough(period?.through || data?.through || "") } }}><PopoverTrigger asChild><Button variant="outline">{period ? `${period.from} – ${period.through}` : "Reporting period"}</Button></PopoverTrigger><PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] space-y-4"><p className="font-semibold">Reporting period</p><FormField id="sales-from" label="From"><Input id="sales-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></FormField><FormField id="sales-through" label="Through (inclusive)"><Input id="sales-through" type="date" value={through} onChange={e => setThrough(e.target.value)} /></FormField>{periodError && <p role="alert" className="text-sm text-destructive">{periodError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPeriodOpen(false)}>Cancel</Button><Button onClick={applyPeriod}>Apply period</Button></div></PopoverContent></Popover>
      <Filters activeCount={[salesTeamId, lostReasonId, owner, source].filter(Boolean).length + Object.keys(attributionQuery(attribution)).length + Object.keys(extensionQuery).length} onReset={() => { setSalesTeamId(""); reset() }}>
        {scope === "team" && <FormField id="sales-owner" label="Salesperson"><RecordSelect id="sales-owner" endpoint="/api/crm/assignees" value={owner} onChange={setOwner} placeholder="All salespeople" /></FormField>}
        <AttributionFilters value={attribution} onChange={setAttribution} choicesEndpoint={`/api/crm/reports/sales/attribution-choices?${params}`} responsibleLabel="Salesperson type" />
        <SalesTeamSelect all value={salesTeamId} onChange={setSalesTeamId} /><LostReasonFilter value={lostReasonId} onChange={setLostReasonId} />
        <FormField id="sales-source" label={term("crm.enquiry.singular", "Lead source", "{label} source")}><RecordSelect id="sales-source" endpoint="/api/crm/lead-sources?includeArchived=true" value={source} onChange={setSource} placeholder="All sources" /></FormField>
        <CrmExtensionFilter primaryId={primaryId} secondaryId={secondaryId} onChange={(p, s) => { setPrimaryId(p); setSecondaryId(s) }} />
      </Filters><Button variant="outline" onClick={() => setRevision(v => v + 1)}>Refresh</Button>
    </div>{data && <p className="text-sm text-muted-foreground">{formatDate(data.from)} through {formatDate(data.through)}, inclusive · {data.timeZone}.{" "}{term("crm.enquiry.plural", "Leads")} use their creation date; won/lost {term("crm.opportunity.plural", "deals")} use their closing date. Pipeline and follow-up coverage show current work across all dates.</p>}</Surface>
    <ReportError error={error} />
    {loading ? <p role="status">Loading sales report…</p> : data && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(Object.keys(labels) as SalesReportView[]).map(view => <button key={view} type="button" onClick={() => select(view)} className="rounded-xl border bg-card p-4 text-left sm:p-5 shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><p className="text-sm text-muted-foreground">{labels[view]}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{data.totals[view]}</p>{view === "converted" && <p className="mt-1 text-xs text-muted-foreground">{data.conversionPercent}% of {term("crm.enquiry.plural", "leads")} created in period</p>}</button>)}</div>
      <p className="text-sm text-muted-foreground">{`Salesperson filters use current record ownership. Partner and supervisor filters use saved introduction details. No recorded partner does not prove internal origin. Overdue follow-ups belong to the selected ${term("crm.enquiry.plural", "leads")} or ${term("crm.opportunity.plural", "deals")}, including work assigned to other users. ${term("crm.contact.singular", "Contact")}-only work is in ${term("crm.activity.singular", "Activity")} overview. ${term("crm.opportunity.singular", "A deal", "The {label}")} is covered when it has any directly linked open or in-progress ${term("crm.activity.singular", "activity")}.`}</p>
      <LeadBreakdown key={`leads:${params}:${data.dimensions.map(item => item.key).join(",")}`} params={params} revision={revision} dimensions={data.dimensions} onSelect={select} />
      <DealValues key={`values:${params}`} params={params} revision={revision} onSelect={select} formatMoney={formatMoney} />
      <div id="sales-records" className="scroll-mt-5 space-y-3"><div className="flex flex-wrap items-center gap-2"><Select aria-label="Report records" value={selected.view} onValueChange={v => select(v as SalesReportView)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>{Object.keys(selected.extra).length > 0 && <Button variant="outline" onClick={() => select(selected.view)}>Clear breakdown selection</Button>}</div><ReportRecords key={details} params={details} view={selected.view} revision={revision} columns={data.extensionColumns} formatMoney={formatMoney} caption={"caption" in selected ? reportBucketLabel(term, data.dimensions.find(item => item.key === selected.extra.dimension), selected.extra.bucket, selected.caption || "") : undefined} /></div>
    </>}
  </section>
}
