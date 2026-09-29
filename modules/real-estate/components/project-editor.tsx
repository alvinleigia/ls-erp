"use client"
import { useCustomFields } from "@/modules/crm/components/custom-fields"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { useFormErrors } from "@/hooks/use-form-errors"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { CrmSelect, CrmTextarea } from "@/modules/crm/components/crm-controls"
import { CrmPageHeader, CrmFormActions, crmPageClass } from "@/modules/crm/components/crm-page"
import { CrmSection } from "@/modules/crm/components/crm-section"
import { CrmPagination } from "@/modules/crm/components/crm-pagination"
import { RecordSelect } from "@/modules/crm/components/record-select"
import { ChoiceSelect } from "./choice-select"
import type { PropertyDefaults } from "../choices"
import { ProjectList, choiceLabel } from "./project-list"
import type { Project } from "@/types/real-estate"
import { ProjectSales } from "./project-sales"

const empty: Project = { id: "", name: "", code: "", parentId: null, developerAccountId: null, location: "", description: "", categories: [], lifecycle: "", priceMin: "", priceMax: "", currency: "", archived: false, version: 1 }
export function ProjectEditor({ id, parentId = "" }: { id?: string; parentId?: string }) {
  const router = useRouter()
  const custom = useCustomFields("project", id)
  const loadCustom = custom.load
  const [record, setRecord] = React.useState<Project>({ ...empty, parentId: parentId || null })
  const [canManage, setCanManage] = React.useState(false), [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(""), [loadError, setLoadError] = React.useState(""), [revision, setRevision] = React.useState(0), [confirm, setConfirm] = React.useState(false)
  const [originalArchived, setOriginalArchived] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setLoadError("")
      try {
        const response = await fetch(id ? `/api/real-estate/projects/${id}` : "/api/real-estate/projects?pageSize=1", { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Unable to load project.")
        setCanManage(data.canManage)
        if (id) { await loadCustom(data); setRecord(data); setOriginalArchived(data.archived) }
        else {
          const defaultsResponse = await fetch("/api/real-estate/choices/defaults", { signal: controller.signal, cache: "no-store" })
          if (!defaultsResponse.ok) throw new Error("Unable to load project defaults.")
          const defaults: PropertyDefaults = await defaultsResponse.json()
          const status = defaults["project-statuses"], category = defaults["property-categories"]
          const initial = { ...empty, lifecycle: status?.id || "", lifecycleName: status?.name, categories: category ? [category.id] : [], categoryNames: category ? { [category.id]: category.name } : {} }
          setRecord(initial)
          if (parentId) {
            const parentResponse = await fetch(`/api/real-estate/projects/${parentId}`, { signal: controller.signal, cache: "no-store" })
            const parent = await parentResponse.json()
            if (!parentResponse.ok || parent.parentId || parent.archived) throw new Error("Choose an active top-level project.")
            setRecord({ ...initial, parentId, parent })
          }
        }
      } catch (error) { if (!controller.signal.aborted) setLoadError((error as Error).message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [id, parentId, revision, loadCustom])
  const cancelHref = record.parentId ? `/crm/projects/${record.parentId}` : "/crm/projects"
  const change = <K extends keyof Project>(key: K, value: Project[K]) => setRecord(previous => ({ ...previous, [key]: value }))
  async function save() {
    setSaving(true); setError(""); clearErrors()
    const { name, code, parentId, developerAccountId, location, description, categories, lifecycle, priceMin, priceMax, currency, archived, version } = record
    try {
      const response = await fetch(`/api/real-estate/projects${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...custom.payload, name, code, parentId: parentId || "", developerAccountId: developerAccountId || "", location, description, categories, lifecycle, priceMin: priceMin || "", priceMax: priceMax || "", currency: currency || "", archived, ...(id ? { version } : {}) }) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save project.") }
      setConfirm(false); toast.success("Project saved.")
      if (!id) router.push(`/crm/projects/${data.id}`)
      else setRevision(value => value + 1)
    } catch (error) { setError((error as Error).message); setConfirm(false) } finally { setSaving(false) }
  }
  if (loading || loadError) return <div className={crmPageClass}><CrmPageHeader title="Project" backHref="/crm/projects" actions={<Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button>} /><p role={loadError ? "alert" : undefined}>{loadError || "Loading project…"}</p></div>
  if (!id && !canManage) return <p role="alert">Only managers can create projects.</p>
  const field = (key: "name" | "code" | "location" | "priceMin" | "priceMax" | "currency", label: string, required = false) => <FormField id={`project-${key}`} label={label} error={errors[key]}><Input id={`project-${key}`} value={record[key] || ""} required={required} maxLength={key === "currency" ? 3 : key === "code" ? 40 : key === "name" ? 160 : key === "location" ? 300 : 19} onChange={event => change(key, event.target.value)} /></FormField>
  return <div className={crmPageClass}>
    <CrmPageHeader title={id ? record.name : record.parentId ? "New subproject" : "New project"} description={record.parent ? <>Part of <Link className="underline" href={`/crm/projects/${record.parent.id}`}>{record.parent.name}</Link>{record.parent.archived && " · Parent archived"}</> : "Project sales information"} backHref={cancelHref} badge={record.archived ? <span className="rounded bg-muted px-2 py-1 text-xs">Archived</span> : undefined} actions={<CrmFormActions form="project-form" cancelHref={cancelHref} canSave={canManage} disabled={custom.blocked} saving={saving} saveLabel="Save project"><Button type="button" variant="outline" disabled={saving} onClick={() => setRevision(value => value + 1)}>Refresh</Button></CrmFormActions>} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <form id="project-form" onSubmit={event => { event.preventDefault(); if (id && record.archived !== originalArchived) setConfirm(true); else void save() }} className="space-y-6">
      <fieldset disabled={!canManage || saving} className="min-w-0 space-y-6">
        <CrmSection title="Project details" description="Codes are unique across projects and subprojects in this business."><div className="grid gap-4 sm:grid-cols-2">{field("name", "Project name", true)}{field("code", "Project code", true)}{field("location", "Location")}
          <FormField id="project-developer" label="Developer account (optional)" error={errors.developerAccountId}><RecordSelect id="project-developer" endpoint="/api/crm/accounts" value={record.developerAccountId || ""} selected={record.developerAccount ? { value: record.developerAccount.id, label: record.developerAccount.name } : undefined} disabled={!canManage || saving} onChange={value => change("developerAccountId", value)} />{record.developerRestricted && <p className="text-sm text-muted-foreground">Developer account is restricted.</p>}{canManage && record.developerAccountId && <Button type="button" variant="ghost" size="sm" onClick={() => change("developerAccountId", null)}>Clear developer</Button>}</FormField>
          <FormField id="project-lifecycle" label="Sales lifecycle"><ChoiceSelect kind="project-statuses" id="project-lifecycle" value={record.lifecycle} name={record.lifecycleName} disabled={!canManage || saving} onChange={(lifecycle, lifecycleName) => setRecord(previous => ({ ...previous, lifecycle, lifecycleName }))} /></FormField>
          <FormField id="project-status" label="Record status"><CrmSelect id="project-status" className="w-full" value={record.archived ? "archived" : "active"} disabled={!canManage || saving} onValueChange={value => change("archived", value === "archived")}><option value="active">Active</option><option value="archived">Archived</option></CrmSelect></FormField>
        </div><FormField id="project-description" label="Description" error={errors.description}><CrmTextarea id="project-description" maxLength={5000} value={record.description} onChange={event => change("description", event.target.value)} /></FormField></CrmSection>
        <CrmSection title="Property and pricing" description="Indicative marketing information. Prices and sales lifecycle do not represent unit availability."><fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Property categories</legend><ChoiceSelect kind="property-categories" id="project-category" value="" placeholder="Add a property category…" disabled={!canManage || saving || record.categories.length >= 50} onChange={(id, name) => setRecord(previous => ({ ...previous, categories: [...new Set([...previous.categories, id])], categoryNames: { ...previous.categoryNames, [id]: name || id } }))} /><div className="flex flex-wrap gap-2">{record.categories.map(id => <span key={id} className="inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm">{record.categoryNames?.[id] || choiceLabel(id)}{canManage && <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${record.categoryNames?.[id] || choiceLabel(id)}`} onClick={() => change("categories", record.categories.filter(item => item !== id))}>×</Button>}</span>)}</div></fieldset><div className="grid gap-4 sm:grid-cols-3">{field("priceMin", "Indicative minimum price")}{field("priceMax", "Indicative maximum price")}{field("currency", "Currency code (e.g. INR)")}</div></CrmSection>
        {custom.section(!canManage || saving)}
      </fieldset>
    </form>
    {id && !record.parentId && <ProjectList parentId={id} canManage={canManage} parentArchived={record.archived} />}
    {id && <ProjectSales project={{ ...record, canManage }} />}
    {id && canManage && (record.parentId ? <CrmSection title="Staff access"><p className="text-sm text-muted-foreground">Staff access is inherited from the parent project.</p><Button variant="outline" asChild><Link href={`/crm/projects/${record.parentId}`}>Manage parent project</Link></Button></CrmSection> : <ProjectMembers id={id} version={record.version} archived={record.archived} onVersion={version => change("version", version)} />)}
    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>{record.archived ? "Archive project?" : "Restore project?"}</DialogTitle><DialogDescription>{record.archived ? "Staff will lose access to this project and its subprojects. All records and staff assignments will be kept." : "Existing staff assignments will apply again. Subprojects keep their own archive state."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void save()}>Confirm and save</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function ProjectMembers({ id, version, archived, onVersion }: { id: string; version: number; archived: boolean; onVersion: (version: number) => void }) {
  const [page, setPage] = React.useState(1), [pageSize, setPageSize] = React.useState(10)
  const [rows, setRows] = React.useState<{ id: string; name: string | null; status: string }[]>([]), [total, setTotal] = React.useState(0)
  const [selected, setSelected] = React.useState(""), [error, setError] = React.useState(""), [saving, setSaving] = React.useState(false), [loading, setLoading] = React.useState(true)
  const [remove, setRemove] = React.useState<{ id: string; name: string | null } | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/real-estate/projects/${id}/members?page=${page}&pageSize=${pageSize}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load staff access.")
      setRows(data.items); setTotal(data.total)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, page, pageSize, version])
  async function save(userId: string, removing: boolean) {
    setSaving(true); setError("")
    try {
      const response = await fetch(`/api/real-estate/projects/${id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, version, remove: removing }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to update staff access.")
      onVersion(data.version); setSelected(""); setRemove(null); setPage(1); toast.success("Staff access updated.")
    } catch (error) { setError((error as Error).message); setRemove(null) } finally { setSaving(false) }
  }
  return <CrmSection title="Responsible staff and access" description="Assigned staff can read this project and its active subprojects. Managers can manage every project. Customer and opportunity access is unchanged.">
    {!archived && <div className="flex flex-wrap items-end gap-3"><FormField id="project-member" label="Assign staff" className="min-w-0 flex-1 basis-52"><RecordSelect id="project-member" endpoint="/api/crm/assignees" value={selected} onChange={setSelected} disabled={saving} /></FormField><Button disabled={!selected || saving} loading={saving} onClick={() => void save(selected, false)}>Add staff</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <ul className="divide-y rounded-lg border">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm"><span>{row.name || "Unnamed staff"}{row.status !== "ACTIVE" && <span className="ml-2 text-muted-foreground">({choiceLabel(row.status)})</span>}</span>{!archived && <Button size="sm" variant="outline" disabled={saving} onClick={() => setRemove(row)}>Remove<span className="sr-only"> {row.name}</span></Button>}</li>)}{!rows.length && <li className="p-5 text-sm text-muted-foreground">{loading ? "Loading staff…" : "No staff assigned. Only managers can access this project."}</li>}</ul>
    <CrmPagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    <Dialog open={!!remove} onOpenChange={open => { if (!open && !saving) setRemove(null) }}><DialogContent><DialogHeader><DialogTitle>Remove staff access?</DialogTitle><DialogDescription>{remove?.name} will no longer have this project assignment. Managers retain management access.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setRemove(null)}>Cancel</Button><Button loading={saving} onClick={() => remove && void save(remove.id, true)}>Remove access</Button></DialogFooter></DialogContent></Dialog>
  </CrmSection>
}
