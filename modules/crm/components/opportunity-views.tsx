"use client"
import { SalesTeamSelect } from "./sales-teams"
import { CustomFieldFilter, emptyCustomFilter } from "./custom-fields"
import { LostReasonFields, LostReasonFilter } from "./lost-reason-fields"
import { ExportButton } from "./export-button"
import { CrmExtensionCaption, CrmExtensionFilter } from "./extension-provider"
import { CrmPageHeader, CrmSurface, CrmFilters, crmPageClass } from "./crm-page"
import { CrmTablePagination, CrmPagination } from "./crm-pagination"
import { CrmSelect, CrmCheckbox } from "./crm-controls"
import { useCurrentResourceAction } from "@/platform/access/view-guard"
import * as React from "react"
import Link from "@/platform/access/link"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { DataTable } from "@/components/data-table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useDateFormatter } from "@/hooks/use-date-formatter"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import type { ListResponse } from "@/types/api"
import type { CrmOpportunityRow, CrmPipelineRow, CrmStageRow } from "@/types/crm"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"

function useOpportunityPage(params: string, revision: number) {
  const [data, setData] = React.useState<ListResponse<CrmOpportunityRow> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true); setError(""); setData(null)
      try {
        const response = await fetch(`/api/crm/opportunities?${params}`, { signal: controller.signal, cache: "no-store" })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Unable to load opportunities.")
        setData(result)
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [params, revision])
  return { data, loading, error }
}
type Moves = { stages: CrmStageRow[]; busy: boolean; move: (record: CrmOpportunityRow, stage: CrmStageRow) => void }
type Money = { formatMoney: (amount: string, currency: string) => string }
function StageSelect({ record, stages, busy, move }: Moves & { record: CrmOpportunityRow }) {
  return <CrmSelect aria-label={`Move ${record.title} to stage`} className={`${selectClass} w-full`} disabled={busy} value={record.stageId} onValueChange={event => { const stage = stages.find(item => item.id === event); if (stage) move(record, stage) }}>
    {stages.filter(stage => !stage.archived || stage.id === record.stageId).map(stage => <option key={stage.id} value={stage.id} disabled={stage.archived}>{stage.name}{stage.archived ? " (archived)" : ""}</option>)}
  </CrmSelect>
}
function BoardColumn({ stage, params, revision, onDrag, onDrop, formatMoney, ...moves }: Moves & Money & { stage: CrmStageRow; params: string; revision: number; onDrag: (record: CrmOpportunityRow | null) => void; onDrop: (stage: CrmStageRow) => void }) {
  const [page, setPage] = React.useState(1)
  const { data, loading, error } = useOpportunityPage(`${params}&stageId=${encodeURIComponent(stage.id)}&page=${page}&pageSize=20`, revision)
  const { formatDate } = useDateFormatter()
  return <section aria-label={`${stage.name} opportunities`} className="w-72 shrink-0 rounded-xl border bg-muted/30" onDragOver={event => { if (!stage.archived && !moves.busy) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (!stage.archived) onDrop(stage) }}>
    <div className="space-y-1 border-t-4 p-4" style={{ borderTopColor: stage.color }}><h2 className="font-semibold">{stage.name} {stage.archived && "(archived)"}</h2><p className="text-xs text-muted-foreground">{data ? `${data.total} opportunities` : "Loading…"}</p></div>
    <div className="space-y-3 px-3 pb-3">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm">Loading…</p>}
      {!loading && data?.total === 0 && <p className="py-5 text-sm text-muted-foreground">No opportunities</p>}
      {!loading && data?.items.map(record => <article key={record.id} draggable={!moves.busy} onDragStart={event => { event.dataTransfer.setData("text/plain", record.id); event.dataTransfer.effectAllowed = "move"; onDrag(record) }} onDragEnd={() => onDrag(null)} className="space-y-3 rounded-lg border bg-background p-3 shadow-sm">
        <Link className="block break-words font-medium underline" href={`/crm/opportunities/${record.id}`}>{record.title}</Link><CrmExtensionCaption record={record} />{record.lostReasonName && <p className="text-xs text-muted-foreground">Lost reason: {record.lostReasonName}</p>}
        <p className="text-sm">{record.contact.name}{record.account ? ` · ${record.account.name}` : ""}</p>
        <p className="font-medium tabular-nums">{formatMoney(record.amount, record.currency)}</p>
        <p className="text-xs text-muted-foreground">{record.probability}% · {formatDate(record.expectedCloseOn.slice(0, 10))}<br />{record.assignee.name || "Unnamed salesperson"}</p>
        <StageSelect record={record} {...moves} />
        {!!record.overdueActivityCount && <Link className="block text-sm text-destructive underline" href={`/crm/opportunities/${record.id}`}>{record.overdueActivityCount} overdue {record.overdueActivityCount === 1 ? "activity" : "activities"}</Link>}
      </article>)}
      <CrmPagination label={`${stage.name} pages`} page={page} pageSize={20} total={data?.total ?? 0} totalPages={data?.totalPages} loading={loading} onPageChange={setPage} />
    </div>
  </section>
}
function OpportunityTable({ params, revision, formatMoney, ...moves }: Moves & Money & { params: string; revision: number }) {
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 })
  const { data, loading, error } = useOpportunityPage(`${params}&page=${pagination.pageIndex + 1}&pageSize=${pagination.pageSize}`, revision)
  const { formatDate } = useDateFormatter()
  const { stages, busy, move } = moves
  const columns = React.useMemo<ColumnDef<CrmOpportunityRow>[]>(() => [
    { accessorKey: "title", header: "Opportunity", cell: ({ row }) => <><Link className="underline" href={`/crm/opportunities/${row.original.id}`}>{row.original.title}</Link><CrmExtensionCaption record={row.original} /></> },
    { id: "contact", header: "Contact", cell: ({ row }) => row.original.contact.name },
    { id: "amount", header: "Value", cell: ({ row }) => formatMoney(row.original.amount, row.original.currency) },
    { accessorKey: "probability", header: "Probability", cell: ({ row }) => `${row.original.probability}%` },
    { accessorKey: "expectedCloseOn", header: "Expected close", cell: ({ row }) => formatDate(row.original.expectedCloseOn.slice(0, 10)) },
    { id: "owner", header: "Salesperson", cell: ({ row }) => row.original.assignee.name },
    { accessorKey: "lostReasonName", header: "Lost reason", cell: ({ row }) => row.original.lostReasonName || (row.original.stage.kind === "LOST" ? "Not recorded (legacy)" : "—") },
    { id: "overdue", header: "Overdue activities", cell: ({ row }) => row.original.overdueActivityCount || "—" },
    { id: "stage", header: "Stage", cell: ({ row }) => <StageSelect record={row.original} stages={stages} busy={busy} move={move} /> },
  ], [formatDate, formatMoney, stages, busy, move])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data?.items ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data?.total ?? 0, state: { pagination },
    onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }),
  })
  return <div className="space-y-4">{error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No opportunities match these filters." /><CrmTablePagination table={table} totalRows={data?.total ?? 0} loading={loading} /></div>
}

export function OpportunityViews() {
  const mayEdit = useCurrentResourceAction("edit")
  const [moneySettings, setMoneySettings] = React.useState<AppSettingsPayload | undefined>(undefined)
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/settings/display", { signal: controller.signal, cache: "no-store" }).then(async response => { if (response.ok) setMoneySettings((await response.json()).settings) }).catch(() => {})
    return () => controller.abort()
  }, [])
  const formatMoney = React.useCallback((amount: string, currency: string) => formatDecimalCurrency(amount, currency, moneySettings), [moneySettings])
  const [pipeline, setPipeline] = React.useState<CrmPipelineRow | null>(null)
  const [pipelineId, setPipelineId] = React.useState("")
  const [archive, setArchive] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [customFilter, setCustomFilter] = React.useState(emptyCustomFilter)
  const [owner, setOwner] = React.useState("")
  const [kind, setKind] = React.useState("")
  const [projectId, setProjectId] = React.useState("")
  const [subprojectId, setSubprojectId] = React.useState("")
  const [sort, setSort] = React.useState("updatedAt")
  const [order, setOrder] = React.useState("desc")
  const [view, setView] = React.useState<"board" | "list">("board")
  const [revision, setRevision] = React.useState(0)
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [drag, setDrag] = React.useState<CrmOpportunityRow | null>(null)
  const [pending, setPending] = React.useState<{ record: CrmOpportunityRow; stage: CrmStageRow } | null>(null)
  const [lossReason, setLossReason] = React.useState("")
  const [lostReasonId, setLostReasonId] = React.useState("")
  const [reasonFilter, setReasonFilter] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/crm/pipelines?pageSize=1", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load pipelines.")
      setPipelineId(data.items[0]?.id || "")
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [])
  React.useEffect(() => {
    if (!pipelineId) return
    const controller = new AbortController()
    void fetch(`/api/crm/pipelines/${pipelineId}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load stages.")
      setPipeline(data)
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setPipeline(null) } })
    return () => controller.abort()
  }, [pipelineId, revision])
  const persistMove = React.useCallback(async (record: CrmOpportunityRow, stage: CrmStageRow, reason = "", lostReasonId = "") => {
    setBusy(true); setError("")
    try {
      const response = await fetch(`/api/crm/opportunities/${record.id}/move`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipelineId: record.pipelineId, stageId: stage.id, version: record.version, lossReason: reason, lostReasonId }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to move opportunity.")
      toast.success(`Moved to ${stage.name}.`); setPending(null); setLossReason("")
    } catch (error) { setPending(null); setError((error as Error).message); toast.error((error as Error).message) }
    finally { setBusy(false); setRevision(value => value + 1) }
  }, [])
  const move = React.useCallback((record: CrmOpportunityRow, stage: CrmStageRow) => {
    if (!mayEdit || busy || record.stageId === stage.id) return
    if (stage.kind === "LOST") { setPending({ record, stage }); setLossReason(record.stage.kind === "LOST" ? record.lossReason || "" : ""); setLostReasonId(record.stage.kind === "LOST" ? record.lostReasonId || "" : "") }
    else void persistMove(record, stage)
  }, [busy, persistMove, mayEdit])
  const [salesTeamId, setSalesTeamId] = React.useState("")
  const params = new URLSearchParams({ ...(salesTeamId ? { salesTeamId } : {}), ...(customFilter.customFieldId && customFilter.customFieldValue !== "" ? customFilter : {}), pipelineId, q, sort, order, ...(reasonFilter ? { lostReasonId: reasonFilter } : {}), ...(projectId ? { projectId } : {}), ...(subprojectId ? { subprojectId } : {}), ...(owner ? { assignedUserId: owner } : {}), ...(kind ? { kind } : {}) }).toString()
  const ready = pipeline?.id === pipelineId
  return <section className={crmPageClass}>
    <CrmPageHeader title="Opportunities" description="Track deals through your sales pipeline." actions={<><Button variant="outline" asChild><Link href="/crm/pipelines">Pipelines</Link></Button><Button asChild><Link href="/crm/opportunities/new">New opportunity</Link></Button></>} />
    <CrmSurface><div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]"><FormField id="pipeline-filter" label="Pipeline"><RecordSelect id="pipeline-filter" endpoint={`/api/crm/pipelines?archived=${archive}`} value={pipelineId} selected={ready && pipeline ? { value: pipeline.id, label: pipeline.name } : undefined} onChange={value => { setPipelineId(value); setError("") }} /></FormField><FormField id="opportunity-search" label="Search"><Input id="opportunity-search" placeholder="Search titles…" value={q} onChange={event => setQ(event.target.value)} /></FormField><div className="flex flex-wrap gap-2"><CrmFilters activeCount={[!!salesTeamId, !!customFilter.customFieldId, !!reasonFilter, !!owner, !!kind, !!projectId, !!subprojectId, archive, sort !== "updatedAt", order !== "desc"].filter(Boolean).length} onReset={() => { setCustomFilter(emptyCustomFilter); setReasonFilter(""); setSalesTeamId(""); setOwner(""); setKind(""); setProjectId(""); setSubprojectId(""); setArchive(false); setSort("updatedAt"); setOrder("desc") }}><CrmExtensionFilter primaryId={projectId} secondaryId={subprojectId} onChange={(project, subproject) => { setProjectId(project); setSubprojectId(subproject) }} /><SalesTeamSelect all value={salesTeamId} onChange={setSalesTeamId} /><LostReasonFilter value={reasonFilter} onChange={setReasonFilter} /><FormField id="owner-filter" label="Salesperson"><RecordSelect id="owner-filter" endpoint="/api/crm/assignees" value={owner} onChange={setOwner} /></FormField><FormField id="kind-filter" label="Outcome"><CrmSelect id="kind-filter" className={`${selectClass} w-full`} value={kind} onValueChange={event => setKind(event)}><option value="">All outcomes</option><option>OPEN</option><option>WON</option><option>LOST</option></CrmSelect></FormField><div className="space-y-2"><p className="text-sm font-medium">Sort opportunities</p><CrmSelect aria-label="Sort opportunities" className={`${selectClass} w-full`} value={sort} onValueChange={event => setSort(event)}><option value="updatedAt">Last updated</option><option value="expectedCloseOn">Expected close</option><option value="title">Title</option></CrmSelect></div><div className="space-y-2"><p className="text-sm font-medium">Sort direction</p><CrmSelect aria-label="Sort direction" className={`${selectClass} w-full`} value={order} onValueChange={event => setOrder(event)}><option value="desc">Descending</option><option value="asc">Ascending</option></CrmSelect></div><label className="flex items-center gap-2 text-sm"><CrmCheckbox checked={archive} onChange={event => setArchive(event.target.checked)} />Search archived pipelines</label><CustomFieldFilter resource="opportunity" value={customFilter} onChange={setCustomFilter} /></CrmFilters><Button variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</Button></div></div><div className="flex flex-wrap gap-2 border-t pt-4"><ExportButton href={`/api/crm/opportunities/export?${params}`} filename="opportunities.csv" disabled={busy || !ready || !pipelineId} /><Button variant={view === "board" ? "default" : "outline"} aria-pressed={view === "board"} onClick={() => setView("board")}>Kanban</Button><Button variant={view === "list" ? "default" : "outline"} aria-pressed={view === "list"} onClick={() => setView("list")}>List</Button></div></CrmSurface>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!pipelineId && <p>Select a pipeline, or ask a manager to create one under <Link className="underline" href="/crm/pipelines">Pipelines</Link>.</p>}
    {pipelineId && !ready && <p>Loading pipeline…</p>}
    {ready && pipeline && <>{pipeline.archived && <p className="text-sm">Archived pipeline. Open an opportunity to move it to an active pipeline.</p>}{view === "board" ? <><p className="text-sm text-muted-foreground">Drag cards between stages or use each card’s stage selector. Columns are paginated independently.</p><div className="flex gap-4 overflow-x-auto pb-4">{pipeline.stages.filter(stage => !kind || stage.kind === kind).map(stage => <BoardColumn key={`${stage.id}:${params}:${revision}`} stage={stage} params={params} revision={revision} stages={pipeline.stages} busy={busy || pipeline.archived || !mayEdit} move={move} formatMoney={formatMoney} onDrag={setDrag} onDrop={stage => { if (drag && !pipeline.archived) move(drag, stage); setDrag(null) }} />)}</div></> : <CrmSurface><OpportunityTable key={params} params={params} revision={revision} stages={pipeline.stages} busy={busy || pipeline.archived || !mayEdit} move={move} formatMoney={formatMoney} /></CrmSurface>}</>}
    <Dialog open={!!pending} onOpenChange={open => { if (!open && !busy) setPending(null) }}><DialogContent><DialogHeader><DialogTitle>Close as lost</DialogTitle><DialogDescription>Record why {pending?.record.title} was lost. It will remain available in the pipeline and history.</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); if (pending) void persistMove(pending.record, pending.stage, lossReason, lostReasonId) }} className="space-y-4"><LostReasonFields value={lostReasonId} name={pending?.record.lostReasonName} note={lossReason} onReasonChange={setLostReasonId} onNoteChange={setLossReason} /><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setPending(null)}>Cancel</Button><Button type="submit" loading={busy} disabled={!lostReasonId}>Close as lost</Button></DialogFooter></form></DialogContent></Dialog>
  </section>
}
