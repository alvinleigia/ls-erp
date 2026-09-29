"use client"
import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { CrmSelect } from "@/modules/crm/components/crm-controls"
import { CrmTablePagination } from "@/modules/crm/components/crm-pagination"
import { RecordList } from "@/modules/crm/components/record-list"
import { WorkList } from "@/modules/crm/components/work-list"
import type { CrmOpportunityRow } from "@/types/crm"
import type { Project } from "@/types/real-estate"

export function ProjectSales({ project }: { project: Project }) {
  const projectId = project.parentId || project.id, subprojectId = project.parentId ? project.id : undefined
  const query = new URLSearchParams({ projectId, ...(subprojectId ? { subprojectId } : {}) }).toString()
  const active = !project.archived && !project.parent?.archived
  return <>
    <CrmSection title="Sales work" description="Only records you can access are shown. Project membership does not grant access to other salespeople's leads or deals.">
      <div className="flex flex-wrap gap-2">{active && <><Button asChild><Link href={`/crm/enquiries/new?${query}`}>New lead</Link></Button><Button variant="outline" asChild><Link href={`/crm/opportunities/new?${query}`}>New opportunity</Link></Button></>}{project.canManage && <Button variant="outline" asChild><Link href="/crm/pipelines/new?template=property">Create property sales pipeline</Link></Button>}</div>
    </CrmSection>
    <RecordList key={`leads-${query}`} kind="enquiries" projectId={projectId} subprojectId={subprojectId} />
    <RelatedOpportunities key={`deals-${query}`} query={query} />

  </>
}
export function ProjectActivities({ project }: { project: Project }) {
  return <WorkList projectId={project.parentId || project.id} subprojectId={project.parentId ? project.id : undefined} initialScope="visible" initialState="all" />
}
function RelatedOpportunities({ query }: { query: string }) {
  const [items, setItems] = React.useState<CrmOpportunityRow[]>([]), [total, setTotal] = React.useState(0)
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 }), [kind, setKind] = React.useState("")
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(""), [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("")
    fetch(`/api/crm/opportunities?${query}&page=${pagination.pageIndex + 1}&pageSize=${pagination.pageSize}${kind ? `&kind=${kind}` : ""}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load opportunities.")
      setItems(data.items); setTotal(data.total)
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setItems([]); setTotal(0) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, pagination, kind, revision])
  const columns = React.useMemo<ColumnDef<CrmOpportunityRow>[]>(() => [
    { accessorKey: "title", header: "Opportunity", cell: ({ row }) => <Link className="underline" href={`/crm/opportunities/${row.original.id}`}>{row.original.title}</Link> },
    { id: "contact", header: "Customer", cell: ({ row }) => row.original.contact.name },
    { id: "pipeline", header: "Pipeline / stage", cell: ({ row }) => `${row.original.pipeline.name} / ${row.original.stage.name}` },
    { id: "owner", header: "Salesperson", cell: ({ row }) => row.original.assignee.name },
  ], [])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: total, state: { pagination }, onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }) })
  return <CrmSection title="Opportunities" description="Linked opportunities across all pipelines."><div className="flex gap-2"><CrmSelect aria-label="Related opportunity outcome" value={kind} onValueChange={value => { setKind(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}><option value="">All outcomes</option><option>OPEN</option><option>WON</option><option>LOST</option></CrmSelect><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>{error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage="No accessible opportunities in this selection." /><CrmTablePagination table={table} totalRows={total} loading={loading} /></CrmSection>
}
