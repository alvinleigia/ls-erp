"use client"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { CrmSelect, CrmCheckbox } from "./crm-controls"
import { CrmSection } from "./crm-section"
import { CrmPageHeader, CrmFormActions, CrmSurface, crmPageClass } from "./crm-page"
import { CrmPagination, CrmTablePagination } from "./crm-pagination"
import { RecordSelect } from "./record-select"
import { QuotationContentFields } from "./quotation-content"
import { useFormErrors } from "@/hooks/use-form-errors"
import { emptyQuotationContent, quotationContentSchema, type QuotationContent } from "../quotation-validation"
import type { QuotationSnapshot } from "../quotation-service"

import type { AppSettingsPayload } from "@/types/scheduling"
import { formatDecimalCurrency } from "@/lib/formatting"
function useQuotationSettings() {
 const [settings, setSettings] = React.useState<AppSettingsPayload>()
 React.useEffect(() => { const controller = new AbortController(); request<{ settings: AppSettingsPayload }>("/api/settings/display", { signal: controller.signal }).then(row => setSettings(row.settings)).catch(() => {}); return () => controller.abort() }, [])
 return settings
}
const templateBase = "/crm/configuration/quotation-templates"
async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { cache: "no-store", ...init }), data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || "Unable to load the document."), { response: data }); return data }
type Item = { id: string; name?: string; title?: string; version: number; currency?: string; consideration?: string }
export function QuotationList({ opportunityId }: { opportunityId?: string }) {
  const template = !opportunityId, settings = useQuotationSettings()
  const [query, setQuery] = React.useState({ pageIndex: 0, pageSize: 10 }), [search, setSearch] = React.useState(""), [archived, setArchived] = React.useState("false")
  const [data, setData] = React.useState<{ items: Item[]; total: number; canManage?: boolean }>({ items: [], total: 0 }), [error, setError] = React.useState(""), [loading, setLoading] = React.useState(true)
  React.useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true); setError("")
      const base = opportunityId ? `/api/crm/opportunities/${opportunityId}/quotations` : "/api/crm/quotation-templates"
      request<typeof data>(`${base}?${new URLSearchParams({ page: String(query.pageIndex + 1), pageSize: String(query.pageSize), q: search, archived })}`, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) { setError(error.message); setData({ items: [], total: 0 }) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [opportunityId, query, search, archived])
  const columns = React.useMemo<ColumnDef<Item>[]>(() => [
    { id: "title", header: template ? "Template" : "Document", cell: ({ row }) => <Link className="font-medium underline" href={template ? `${templateBase}/${row.original.id}` : `/crm/quotations/${row.original.id}`}>{row.original.name || row.original.title}</Link> },
    { accessorKey: "version", header: "Version" },
    ...(!template ? [{ id: "amount", header: "Consideration", cell: ({ row }: { row: { original: Item } }) => formatDecimalCurrency(row.original.consideration || "0", row.original.currency || "USD", settings) }] : []),
  ], [template, settings])
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data.items, columns, state: { pagination: query }, onPaginationChange: update => setQuery(previous => { const next = typeof update === "function" ? update(previous) : update; return next.pageSize !== previous.pageSize ? { ...next, pageIndex: 0 } : next }), manualPagination: true, pageCount: Math.max(1, Math.ceil(data.total / query.pageSize)), getCoreRowModel: getCoreRowModel() })
  const content = <>{error && <p role="alert" className="text-destructive">{error}</p>}{template && <div className="flex flex-wrap gap-3"><Input aria-label="Search templates" placeholder="Search templates…" className="max-w-sm" value={search} onChange={event => { setSearch(event.target.value); setQuery(q => ({ ...q, pageIndex: 0 })) }} /><CrmSelect aria-label="Template status" value={archived} onValueChange={value => { setArchived(value); setQuery(q => ({ ...q, pageIndex: 0 })) }}><option value="false">Active templates</option><option value="true">Archived templates</option></CrmSelect></div>}<DataTable table={table} emptyMessage={loading ? "Loading…" : template ? "No templates found." : "No quotations or payment plans yet."} /><CrmTablePagination table={table} totalRows={data.total} loading={loading} /></>
  return template ? <div className={crmPageClass}><CrmPageHeader title="Quotation / payment-plan templates" backHref="/crm/configuration" actions={data.canManage && <Button asChild><Link href={`${templateBase}/new`}>New template</Link></Button>} /><CrmSurface>{content}</CrmSurface></div> : <CrmSection title="Quotations and payment plans" actions={<Button asChild><Link href={`/crm/quotations/new?opportunityId=${opportunityId}`}>New document</Link></Button>}>{content}</CrmSection>
}

type Document = { id: string; opportunityId: string; title: string; version: number; revision: number; snapshot: QuotationSnapshot }
type Template = { id: string; name: string; content: QuotationContent; version: number; archived: boolean; canManage: boolean }
export function QuotationEditor({ id, opportunityId: initialOpportunityId, template = false, revision }: { id?: string; opportunityId?: string; template?: boolean; revision?: number }) {
  const settings = useQuotationSettings()
  const { errors, setErrors, setErrorsFromResponse, clearErrors } = useFormErrors()
  const router = useRouter(), [opportunityId, setOpportunityId] = React.useState(initialOpportunityId || "")
  const [value, setValue] = React.useState<QuotationContent>(emptyQuotationContent), [name, setName] = React.useState(""), [archived, setArchived] = React.useState(false)
  const [version, setVersion] = React.useState<number>(), [document, setDocument] = React.useState<Document | null>(null), [context, setContext] = React.useState<{ label: string; value: string }[]>([])
  const [error, setError] = React.useState(""), [loading, setLoading] = React.useState(true), [failed, setFailed] = React.useState(false), [saving, setSaving] = React.useState(false), [canManage, setCanManage] = React.useState(false)
  const [templateId, setTemplateId] = React.useState(""), [confirm, setConfirm] = React.useState<"template" | "archive" | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setFailed(false); setError("")
    async function load() {
      if (template) {
        if (id) { const row = await request<Template>(`/api/crm/quotation-templates/${id}`, { signal: controller.signal }); setValue(row.content); setName(row.name); setVersion(row.version); setArchived(row.archived); setCanManage(row.canManage) }
        else { const row = await request<{ canManage: boolean }>("/api/crm/quotation-templates?pageSize=1", { signal: controller.signal }); setCanManage(row.canManage); const display = await request<{ settings: AppSettingsPayload }>("/api/settings/display", { signal: controller.signal }); setValue({ ...emptyQuotationContent, currency: display.settings.currency || "USD" }) }
      } else if (id) {
        const row = await request<Document>(`/api/crm/quotations/${id}${revision ? `?revision=${revision}` : ""}`, { signal: controller.signal }); setDocument(row); setOpportunityId(row.opportunityId); setValue(row.snapshot.content); setVersion(row.version); setContext(row.snapshot.context)
      } else {
        if (!initialOpportunityId) throw new Error("Open an opportunity and choose New document.")
        const row = await request<{ content: QuotationContent; context: typeof context }>(`/api/crm/opportunities/${initialOpportunityId}/quotations/defaults`, { signal: controller.signal }); setValue(row.content); setContext(row.context)
      }
    }
    load().catch(error => { if (!controller.signal.aborted) { setError(error.message); setFailed(true) } }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, template, initialOpportunityId, revision])
  const oldVersion = !!document && document.revision !== document.version
  const back = template ? templateBase : opportunityId ? `/crm/opportunities/${opportunityId}` : "/crm/opportunities"
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(""); clearErrors()
    const parsed = quotationContentSchema.safeParse(value)
    if (!parsed.success) {
      const top: Record<string, string> = { title: "quote-title", currency: "quote-currency", supplierName: "supplier", website: "website", bookingDate: "booking-date", validUntil: "valid-until", registration: "registration", registrationUrl: "registration-url", logoDataUrl: "quote-logo", discount: "discount", terms: "quote-terms" }
      const prefixes: Record<string, string> = { lines: "line", charges: "charge", instalments: "instalment", details: "detail" }
      setErrors(Object.fromEntries(parsed.error.issues.map(issue => { const [root, index, field] = issue.path; const key = root === "bank" ? `bank-${String(index)}` : prefixes[String(root)] && field ? `${prefixes[String(root)]}-${String(field)}-${String(index)}` : top[String(root)] || String(root); return [key, issue.message] })))
      setError(parsed.error.issues[0].message); return
    }
    setSaving(true)
    try {
      const url = template ? `/api/crm/quotation-templates${id ? `/${id}` : ""}` : id ? `/api/crm/quotations/${id}` : `/api/crm/opportunities/${opportunityId}/quotations`
      const row = await request<{ id: string; version: number }>(url, { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: value, version, ...(template ? { name, archived } : templateId ? { templateId } : {}) }) })
      if (!id) router.push(template ? `${templateBase}/${row.id}` : `/crm/quotations/${row.id}`)
      else { setVersion(row.version); if (!template) { const saved = await request<Document>(`/api/crm/quotations/${id}`); setDocument(saved); setValue(saved.snapshot.content); setContext(saved.snapshot.context) } }
    } catch (error) { setErrorsFromResponse((error as { response?: { details?: { fieldErrors?: Record<string, string[]> } } }).response); setError((error as Error).message) } finally { setSaving(false) }
  }
  async function applyTemplate() {
    setConfirm(null); setSaving(true); setError("")
    try { const row = await request<Template>(`/api/crm/quotation-templates/${templateId}`); setValue({ ...row.content, currency: value.currency, bookingDate: value.bookingDate, validUntil: value.validUntil }) } catch (error) { setError((error as Error).message) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading document…</p>
  return <div className={crmPageClass}><form id="quotation-form" onSubmit={save} className="space-y-5">
    <CrmPageHeader title={template ? id ? "Edit quotation template" : "New quotation template" : id ? `${document?.title || "Quotation"} · version ${document?.revision}` : "New quotation / payment plan"} backHref={back} actions={<CrmFormActions form="quotation-form" cancelHref={back} saving={saving} disabled={failed || oldVersion} canSave={!template || canManage} saveLabel={template ? "Save template" : id ? "Save new version" : "Save document"}>{document && <Button asChild variant="outline"><a href={`/api/crm/quotations/${document.id}/pdf?revision=${document.revision}`} target="_blank" rel="noreferrer">Download saved PDF</a></Button>}</CrmFormActions>} />
    {error && <p role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p>}
    {oldVersion && <p className="text-sm">This saved version is read-only. <Link className="underline" href={`/crm/quotations/${id}`}>Edit the latest version</Link>.</p>}
    {document && <CrmPagination page={document.revision} pageSize={1} total={document.version} label="Document versions" onPageChange={number => router.push(`/crm/quotations/${id}?revision=${number}`)} />}
    {template && <CrmSection title="Template configuration"><div className="max-w-md space-y-4"><FormField id="template-name" label="Template name" error={errors.name}><Input id="template-name" required maxLength={150} value={name} disabled={!canManage || saving} onChange={event => setName(event.target.value)} /></FormField><label className="flex items-center gap-2 text-sm"><CrmCheckbox checked={archived} disabled={!canManage || saving} onChange={event => event.target.checked ? setConfirm("archive") : setArchived(false)} />Archived</label></div></CrmSection>}
    {!template && !oldVersion && <CrmSection title="Start from a template" description="Applying a template replaces document contents. Customer and linked project details are retained."><div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end"><FormField id="quotation-template" label="Template" className="min-w-0 flex-1"><RecordSelect id="quotation-template" endpoint="/api/crm/quotation-templates" value={templateId} onChange={setTemplateId} disabled={saving || failed} /></FormField><Button type="button" variant="outline" disabled={!templateId || saving || failed} onClick={() => setConfirm("template")}>Apply template</Button></div></CrmSection>}
    {context.length > 0 && <CrmSection title="Linked project"><dl className="grid gap-3 sm:grid-cols-3">{context.map(item => <div key={item.label}><dt className="text-sm text-muted-foreground">{item.label}</dt><dd>{item.value}</dd></div>)}</dl></CrmSection>}
    <QuotationContentFields errors={errors} settings={document?.snapshot || settings} value={value} onChange={setValue} disabled={saving || failed || oldVersion || (template && !canManage)} template={template} onError={setError} />
  </form><Dialog open={!!confirm} onOpenChange={open => !open && setConfirm(null)}><DialogContent><DialogHeader><DialogTitle>{confirm === "archive" ? "Archive this template?" : "Apply this template?"}</DialogTitle><DialogDescription>{confirm === "archive" ? "The template will be unavailable for new documents after you save. Existing versions are preserved." : "This replaces your current document fields. Previously saved versions remain unchanged."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button><Button onClick={() => confirm === "archive" ? (setArchived(true), setConfirm(null)) : void applyTemplate()}>{confirm === "archive" ? "Archive" : "Apply template"}</Button></DialogFooter></DialogContent></Dialog></div>
}
