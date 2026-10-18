"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { useBusinessModules } from "@/platform/module-provider"
import * as React from "react"
import Link from "@/platform/access/link"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { Section } from "@/components/erp/section"
import { Select } from "@/components/erp/controls"
import { TablePagination } from "@/components/erp/pagination"
import { RecordList } from "@/modules/crm/components/record-list"
import { WorkList } from "@/modules/crm/components/work-list"
import type { CrmOpportunityRow } from "@/types/crm"
import type { Project } from "@/types/real-estate"

export function ProjectSales({ project }: { project: Project }) {
  const term = useTerminology()
  const { can, enabled } = useBusinessModules()
  const projectId = project.parentId || project.id, subprojectId = project.parentId ? project.id : undefined
  const query = new URLSearchParams({ projectId, ...(subprojectId ? { subprojectId } : {}) }).toString()
  const active = !project.archived && !project.parent?.archived
  if (!enabled("realEstate")) return null
  return <>
    <Section title="Sales work" description={term("realEstate.project.singular", "Only records you can access are shown. Project membership does not grant access to other salespeople's", "Only records you can access are shown. {label} membership does not grant access to other salespeople's") + " " + term("crm.enquiry.plural", "leads", "{label}") + " " + term("crm.opportunity.plural", "or deals.", "or {label}.")}>
      <div className="flex flex-wrap gap-2">{active && <><Button asChild><Link href={`/crm/enquiries/new?${query}`}>{term("crm.enquiry.singular", "New lead", "New {label}")}</Link></Button><Button variant="outline" asChild><Link href={`/crm/opportunities/new?${query}`}>{term("crm.opportunity.singular", "New opportunity", "New {label}")}</Link></Button></>}{project.canManage && <Button variant="outline" asChild><Link href="/crm/pipelines/new?template=property">Create property sales pipeline</Link></Button>}</div>
    </Section>
    {can("enquiries.read") && <RecordList key={`leads-${query}`} kind="enquiries" extensionReferences={{ primaryId: projectId, secondaryId: subprojectId || "" }} />}
    {can("opportunities.read") && <RelatedOpportunities key={`deals-${query}`} query={query} />}

  </>
}
export function ProjectActivities({ project }: { project: Project }) {
  const term = useTerminology()
  const { enabled, can } = useBusinessModules()
  const query = new URLSearchParams({ projectId: project.parentId || project.id, ...(project.parentId ? { subprojectId: project.id } : {}) }).toString()
  if (!enabled("realEstate") || !can("activities.read")) return null
  return <WorkList key={query} extensionQuery={query} allowCreate={false} initialScope="visible" initialState="all" guidance={<p className="text-sm text-muted-foreground">{term("crm.enquiry.singular", "Schedule site visits as meetings and follow-ups as calls from a linked enquiry", "Schedule site visits as meetings and follow-ups as calls from a linked {label}") + " " + term("crm.opportunity.singular", "or opportunity.", "or {label}.")}</p>} />
}
function RelatedOpportunities({ query }: { query: string }) {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const [items, setItems] = React.useState<CrmOpportunityRow[]>([]), [total, setTotal] = React.useState(0)
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 }), [kind, setKind] = React.useState("")
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState(""), [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("")
    fetch(`/api/crm/opportunities?${query}&page=${pagination.pageIndex + 1}&pageSize=${pagination.pageSize}${kind ? `&kind=${kind}` : ""}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || readTerm("crm.opportunity.plural", "Unable to load opportunities.", "Unable to load {label}."))
      setItems(data.items); setTotal(data.total)
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setItems([]); setTotal(0) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [readTerm, query, pagination, kind, revision])
  const columns = React.useMemo<ColumnDef<CrmOpportunityRow>[]>(() => [
    { accessorKey: "title", header: term("crm.opportunity.singular", "Opportunity"), cell: ({ row }) => <Link className="underline" href={`/crm/opportunities/${row.original.id}`}>{row.original.title}</Link> },
    { id: "contact", header: term("crm.contact.singular", "Customer"), cell: ({ row }) => row.original.contact.name },
    { id: "pipeline", header: "Pipeline / stage", cell: ({ row }) => `${row.original.pipeline.name} / ${row.original.stage.name}` },
    { id: "owner", header: "Salesperson", cell: ({ row }) => row.original.assignee.name },
  ], [term])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: total, state: { pagination }, onPaginationChange: updater => setPagination(previous => { const next = typeof updater === "function" ? updater(previous) : updater; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }) })
  return <Section title={term("crm.opportunity.plural", "Opportunities")} description={term("crm.opportunity.plural", "Linked opportunities across all pipelines.", "Linked {label} across all pipelines.")}><div className="flex gap-2"><Select aria-label={term("crm.opportunity.singular", "Related opportunity outcome", "Related {label} outcome")} value={kind} onValueChange={value => { setKind(value); setPagination(previous => ({ ...previous, pageIndex: 0 })) }}><option value="">All outcomes</option><option>OPEN</option><option>WON</option><option>LOST</option></Select><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button></div>{error && <p role="alert" className="text-destructive">{error}</p>}<DataTable table={table} loading={loading} emptyMessage={term("crm.opportunity.plural", "No accessible opportunities in this selection.", "No accessible {label} in this selection.")} /><TablePagination table={table} totalRows={total} loading={loading} /></Section>
}
