"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { TablePagination } from "@/components/erp/pagination"
import * as React from "react"
import Link from "@/platform/access/link"
import { type ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { toast } from "sonner"
import { Building2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import type { CrmAccountRow } from "@/types/crm"
import type { ListResponse } from "@/types/api"
import { RecordSelect } from "@/components/erp/record-select"
import { EmptyState, Section } from "@/components/erp/section"

export function ContactAccounts({ contactId, canEdit, archived }: { contactId: string; canEdit: boolean; archived: boolean }) {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const [data, setData] = React.useState<ListResponse<CrmAccountRow> | null>(null)
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })
  const [revision, setRevision] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [accountId, setAccountId] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [removing, setRemoving] = React.useState<CrmAccountRow | null>(null)
  const endpoint = `/api/crm/contacts/${contactId}/accounts`
  React.useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      setLoading(true); setError("")
      try {
        const response = await fetch(`${endpoint}?page=${pagination.pageIndex + 1}&pageSize=${pagination.pageSize}`, { signal: controller.signal, cache: "no-store" })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || readTerm("crm.account.plural", "Unable to load linked accounts.", "Unable to load linked {label}."))
        setData(result)
      } catch (error) { if (!controller.signal.aborted) { setError((error as Error).message); setData(null) } }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [readTerm, endpoint, pagination, revision])
  async function change(unlink?: CrmAccountRow) {
    setSaving(true); setError("")
    try {
      const response = await fetch(unlink ? `${endpoint}/${unlink.id}` : endpoint, {
        method: unlink ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
        ...(!unlink ? { body: JSON.stringify({ accountId }) } : {}),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to update relationship.")
      setAccountId(""); setRemoving(null); setPagination(previous => ({ ...previous, pageIndex: 0 })); setRevision(value => value + 1)
      toast.success(unlink ? term("crm.account.singular", "Account unlinked.", "{label} unlinked.") : term("crm.account.singular", "Account linked.", "{label} linked."))
    } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  const columns = React.useMemo<ColumnDef<CrmAccountRow>[]>(() => [
    { accessorKey: "name", header: term("crm.account.singular", "Business account"), cell: ({ row }) => <Link className="underline" href={`/crm/accounts/${row.original.id}`}>{row.original.name}</Link> },
    { accessorKey: "archived", header: "Status", cell: ({ row }) => row.original.archived ? "Archived" : "Active" },
    ...(canEdit ? [{ id: "actions", header: "Action", cell: ({ row }: { row: { original: CrmAccountRow } }) => <Button variant="outline" size="sm" disabled={saving} onClick={() => setRemoving(row.original)}>Unlink</Button> }] : []),
  ], [canEdit, saving, term])
  const table = useReactTable({ data: data?.items ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, rowCount: data?.total ?? 0,
    state: { pagination }, onPaginationChange: updater => setPagination(previous => {
      const next = typeof updater === "function" ? updater(previous) : updater
      return previous.pageSize !== next.pageSize ? { ...next, pageIndex: 0 } : next
    }),
  })
  return <Section title={term("crm.account.plural", "Business accounts")} description={`${term("crm.account.plural", "Companies")} connected to this ${term("crm.contact.singular", "contact")}.`} icon={Building2} actions={canEdit && !archived && <Button type="button" variant="outline" size="sm" asChild><Link href="/crm/accounts/new"><Plus className="size-4" aria-hidden="true" />{term("crm.account.singular", "New account", "New {label}")}</Link></Button>}>
    {canEdit && !archived && <form onSubmit={event => { event.preventDefault(); void change() }} className="flex flex-wrap items-end gap-3">
      <FormField id="accountId" label={term("crm.account.singular", "Link an account", "Link {label}")} className="min-w-0 basis-48 flex-1"><RecordSelect id="accountId" endpoint="/api/crm/accounts" value={accountId} onChange={setAccountId} disabled={saving} /></FormField>
      <Button type="submit" loading={saving} disabled={!accountId}>{term("crm.account.singular", "Link account", "Link {label}")}</Button>
    </form>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loading && data?.total === 0 ? <EmptyState title={term("crm.account.plural", "No linked business accounts", "No linked {label}")} description={canEdit && !archived ? `Select ${term("crm.account.singular", "an account")} above to connect this ${term("crm.contact.singular", "contact")} to ${term("crm.account.singular", "a company")}.` : `This ${term("crm.contact.singular", "contact")} is not linked to ${term("crm.account.singular", "a company")}.`} /> : <DataTable table={table} loading={loading} emptyMessage={term("crm.account.plural", "No linked business accounts.", "No linked {label}.")} />}
    <TablePagination table={table} totalRows={data?.total ?? 0} loading={loading} />
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !saving) setRemoving(null) }}><DialogContent><DialogHeader><DialogTitle>Unlink {removing?.name}?</DialogTitle><DialogDescription>{`The ${term("crm.contact.singular", "contact")} and ${term("crm.account.singular", "account")} will be kept. This relationship will be removed and the change recorded in audit history.`}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setRemoving(null)}>Cancel</Button><Button loading={saving} onClick={() => removing && void change(removing)}>{term("crm.account.singular", "Unlink account", "Unlink {label}")}</Button></DialogFooter></DialogContent></Dialog>
  </Section>
}
