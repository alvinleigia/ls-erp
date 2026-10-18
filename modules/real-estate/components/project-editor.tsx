"use client"
import { useTerminology, useTerminologyReader } from "@/platform/terminology/provider"
import { useCustomFields } from "@/modules/crm/components/custom-fields"
import { useBusinessModules } from "@/platform/module-provider"
import * as React from "react"
import Link from "@/platform/access/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { formatDecimalCurrency } from "@/lib/formatting"
import type { AppSettingsPayload } from "@/types/scheduling"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { useFormErrors } from "@/hooks/use-form-errors"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/erp/controls"
import { AccessPageHeader, AccessFormActions } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"
import { Section } from "@/components/erp/section"
import { Pagination } from "@/components/erp/pagination"
import { RecordSelect } from "@/components/erp/record-select"
import { ChoiceSelect } from "./choice-select"
import type { PropertyDefaults } from "../choices"
import { ProjectList, choiceLabel } from "./project-list"
import type { Project } from "@/types/real-estate"
import { ProjectSales, ProjectActivities } from "./project-sales"
import { EditPanel, ReadOnlyFields, RecordMenu } from "@/components/erp/record-detail"
import { AccessRecordTabs } from "@/platform/access/record-tabs"
import { CatalogList } from "@/modules/catalog/components/item-list"

const empty: Project = { id: "", name: "", code: "", parentId: null, developerAccountId: null, location: "", description: "", categories: [], lifecycle: "", priceMin: "", priceMax: "", currency: "", archived: false, version: 1 }
export function ProjectEditor({ id, parentId = "" }: { id?: string; parentId?: string }) {
  const readTerm = useTerminologyReader()
  const term = useTerminology()
  const { can, enabled } = useBusinessModules()
  const router = useRouter()
  const custom = useCustomFields("project", id)
  const loadCustom = custom.load
  const [record, setRecord] = React.useState<Project>({ ...empty, parentId: parentId || null })
  const [canManage, setCanManage] = React.useState(false), [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(""), [loadError, setLoadError] = React.useState(""), [revision, setRevision] = React.useState(0), [confirm, setConfirm] = React.useState(false)
  const [saved, setSaved] = React.useState<Project | null>(null)
  const [editing, setEditing] = React.useState<"details" | "pricing" | "custom" | null>(null)
  const [displaySettings, setDisplaySettings] = React.useState<AppSettingsPayload>()
  const [tab, setTab] = React.useState("overview")
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setLoadError("")
      try {
        const response = await fetch(id ? `/api/real-estate/projects/${id}` : "/api/real-estate/projects?pageSize=1", { signal: controller.signal, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || readTerm("realEstate.project.singular", "Unable to load project.", "Unable to load {label}."))
        setCanManage(data.canManage)
        const displayResponse = await fetch("/api/settings/display", { signal: controller.signal, cache: "no-store" })
        if (!displayResponse.ok) throw new Error("Unable to load business display settings. Refresh to try again.")
        const display = await displayResponse.json()
        setDisplaySettings(display.settings)
        if (id) { await loadCustom(data); setRecord(data); setSaved(data) }
        else {
          const defaultsResponse = await fetch("/api/real-estate/choices/defaults", { signal: controller.signal, cache: "no-store" })
          if (!defaultsResponse.ok) throw new Error(readTerm("realEstate.project.singular", "Unable to load project defaults.", "Unable to load {label} defaults."))
          const defaults: PropertyDefaults = await defaultsResponse.json()
          const status = defaults["project-statuses"], category = defaults["property-categories"]
          const initial = { ...empty, currency: display.settings?.currency || "", lifecycle: status?.id || "", lifecycleName: status?.name, categories: category ? [category.id] : [], categoryNames: category ? { [category.id]: category.name } : {} }
          setRecord(initial)
          if (parentId) {
            const parentResponse = await fetch(`/api/real-estate/projects/${parentId}`, { signal: controller.signal, cache: "no-store" })
            const parent = await parentResponse.json()
            if (!parentResponse.ok || parent.parentId || parent.archived) throw new Error(readTerm("realEstate.project.singular", "Choose an active top-level project.", "Choose an active top-level {label}."))
            setRecord({ ...initial, parentId, parent })
          }
        }
      } catch (error) { if (!controller.signal.aborted) setLoadError((error as Error).message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [readTerm, id, parentId, revision, loadCustom])
  const recordKey = record.parentId ? "realEstate.subproject" : "realEstate.project"
  const cancelHref = record.parentId ? `/crm/projects/${record.parentId}` : "/crm/projects"
  const change = <K extends keyof Project>(key: K, value: Project[K]) => setRecord(previous => ({ ...previous, [key]: value }))
  async function save(archive = false) {
    setSaving(true); setError(""); clearErrors()
    const { name, code, parentId, developerAccountId, location, description, categories, lifecycle, priceMin, priceMax, currency, archived, version } = record
    try {
      const response = await fetch(`/api/real-estate/projects${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...custom.payload, name, code, parentId: parentId || "", developerAccountId: developerAccountId || "", location, description, categories, lifecycle, priceMin: priceMin || "", priceMax: priceMax || "", currency: currency || "", archived: archive ? !archived : archived, ...(id ? { version } : {}) }) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || readTerm("realEstate.project.singular", "Unable to save project.", "Unable to save {label}.")) }
      setConfirm(false); setEditing(null); toast.success(term(recordKey + ".singular", "Project saved.", "{label} saved."))
      if (!id) router.push(`/crm/projects/${data.id}`)
      else setRevision(value => value + 1)
    } catch (error) { setError((error as Error).message); setConfirm(false) } finally { setSaving(false) }
  }
  if (loading || loadError) return <div className={pageClass}><AccessPageHeader title={term(recordKey + ".singular", "Project", "{label}")} backHref="/crm/projects" actions={<Button variant="outline" onClick={() => setRevision(value => value + 1)}>Refresh</Button>} /><p role={loadError ? "alert" : undefined}>{loadError || term(recordKey + ".singular", "Loading project…", "Loading {label}…")}</p></div>
  if (!id && !canManage) return <p role="alert">{term("realEstate.project.plural", "Only managers can create projects.", "Only managers can create {label}.")}</p>
  const field = (key: "name" | "code" | "location" | "priceMin" | "priceMax" | "currency", label: string, required = false) => <FormField id={`project-${key}`} label={label} error={errors[key]}><Input id={`project-${key}`} value={record[key] || ""} required={required} maxLength={key === "currency" ? 3 : key === "code" ? 40 : key === "name" ? 160 : key === "location" ? 300 : 19} onChange={event => change(key, event.target.value)} /></FormField>
  function begin(section: "details" | "pricing" | "custom") {
    setError(""); clearErrors(); setEditing(section)
  }
  function cancelEdit() {
    if (saved) { setRecord(saved); void loadCustom(saved) }
    setError(""); clearErrors(); setEditing(null)
  }
  const detailsForm = <>        <Section title={term(recordKey + ".singular", "Project details", "{label} details")} description={term("realEstate.project.plural", "Codes are unique across projects", "Codes are unique across {label}") + " " + term("realEstate.subproject.plural", "and subprojects in this business.", "and {label} in this business.")}><div className="grid gap-4 sm:grid-cols-2">{field("name", term(recordKey + ".singular", "Project name", "{label} name"), true)}{field("code", term(recordKey + ".singular", "Project code", "{label} code"), true)}{field("location", "Location")}
          <FormField id="project-developer" label={term("crm.account.singular", "Developer account (optional)", "Developer {label} (optional)")} error={errors.developerAccountId}><RecordSelect id="project-developer" endpoint="/api/crm/accounts" value={record.developerAccountId || ""} selected={record.developerAccount ? { value: record.developerAccount.id, label: record.developerAccount.name } : undefined} disabled={!canManage || saving} onChange={value => change("developerAccountId", value)} />{record.developerRestricted && <p className="text-sm text-muted-foreground">{term("crm.account.singular", "Developer account is restricted.", "Developer {label} is restricted.")}</p>}{canManage && record.developerAccountId && <Button type="button" variant="ghost" size="sm" onClick={() => change("developerAccountId", null)}>Clear developer</Button>}</FormField>
          <FormField id="project-lifecycle" label="Sales lifecycle"><ChoiceSelect kind="project-statuses" id="project-lifecycle" value={record.lifecycle} name={record.lifecycleName} disabled={!canManage || saving} onChange={(lifecycle, lifecycleName) => setRecord(previous => ({ ...previous, lifecycle, lifecycleName }))} /></FormField>

        </div><FormField id="project-description" label="Description" error={errors.description}><Textarea id="project-description" maxLength={5000} value={record.description} onChange={event => change("description", event.target.value)} /></FormField></Section>
</>
  const pricingForm = <>        <Section title="Property and pricing" description="Indicative marketing information. Prices and sales lifecycle do not represent unit availability."><fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Property categories</legend><ChoiceSelect kind="property-categories" id="project-category" value="" placeholder="Add a property category…" disabled={!canManage || saving || record.categories.length >= 50} onChange={(id, name) => setRecord(previous => ({ ...previous, categories: [...new Set([...previous.categories, id])], categoryNames: { ...previous.categoryNames, [id]: name || id } }))} /><div className="flex flex-wrap gap-2">{record.categories.map(id => <span key={id} className="inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm">{record.categoryNames?.[id] || choiceLabel(id)}{canManage && <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${record.categoryNames?.[id] || choiceLabel(id)}`} onClick={() => change("categories", record.categories.filter(item => item !== id))}>×</Button>}</span>)}</div></fieldset><div className="grid gap-4 sm:grid-cols-3">{field("priceMin", "Indicative minimum price")}{field("priceMax", "Indicative maximum price")}{field("currency", "Currency code (e.g. INR)")}</div></Section>
</>
  const current = saved || record
  const editAction = (section: "details" | "pricing" | "custom", label: string) => canManage ? <Button variant="outline" size="sm" onClick={() => begin(section)}>{label}</Button> : undefined
  const overview = <>
    <Section title={term(recordKey + ".singular", "Project details", "{label} details")} actions={editAction("details", "Edit details")}>
      <ReadOnlyFields fields={[
        { label: term(recordKey + ".singular", "Project code", "{label} code"), value: current.code }, { label: "Location", value: current.location },
        { label: "Sales lifecycle", value: current.lifecycleName || choiceLabel(current.lifecycle) },
        { label: term("crm.account.singular", "Developer account", "Developer {label}"), value: current.developerRestricted ? "Restricted" : current.developerAccount?.name },
        { label: "Description", value: current.description },
      ]} />
    </Section>
    <Section title="Property and pricing" description="Indicative marketing prices; these do not represent unit availability." actions={editAction("pricing", "Edit pricing")}>
      <ReadOnlyFields fields={[
        { label: "Property categories", value: current.categories.map(category => current.categoryNames?.[category] || choiceLabel(category)).join(", ") },
        { label: "Currency", value: current.currency },
        { label: "Indicative minimum price", value: current.priceMin && current.currency ? formatDecimalCurrency(current.priceMin, current.currency, displaySettings) : current.priceMin }, { label: "Indicative maximum price", value: current.priceMax && current.currency ? formatDecimalCurrency(current.priceMax, current.currency, displaySettings) : current.priceMax },
      ]} />
    </Section>
    {custom.readOnlySection(editAction("custom", "Edit additional information"))}
  </>
  return <div className={pageClass}>
    <AccessPageHeader title={id ? current.name : term(recordKey + ".singular", record.parentId ? "New subproject" : "New project", "New {label}")} description={current.parent ? <>Part of <Link className="underline" href={`/crm/projects/${current.parent.id}`}>{current.parent.name}</Link>{current.parent.archived && " (archived)"}</> : id ? [current.code, current.location].filter(Boolean).join(" / ") : "Start with the basics. Add pricing and other details after saving."} backHref={cancelHref} badge={id ? <span className="rounded bg-muted px-2 py-1 text-xs">{current.archived ? "Archived" : current.lifecycleName || "Active"}</span> : undefined} actions={id ? <>
      {canManage && <Button onClick={() => begin("details")}>{term(recordKey + ".singular", "Edit project", "Edit {label}")}</Button>}
      <RecordMenu actions={[{ label: "Refresh", onSelect: () => setRevision(value => value + 1) }, ...(canManage && can("projects.archive") ? [{ label: current.archived ? term(recordKey + ".singular", "Restore project", "Restore {label}") : term(recordKey + ".singular", "Archive project", "Archive {label}"), onSelect: () => { setError(""); setConfirm(true) } }] : [])]} />
    </> : <AccessFormActions form="project-form" cancelHref={cancelHref} canSave={canManage} disabled={custom.blocked} saving={saving} saveLabel={term(recordKey + ".singular", "Save project", "Save {label}")} />} />
    {error && !editing && <p role="alert" className="text-destructive">{error}</p>}
    {!id ? <form id="project-form" onSubmit={event => { event.preventDefault(); void save() }} className="space-y-6"><fieldset disabled={saving} className="min-w-0 space-y-6">{detailsForm}
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-medium">Optional property and pricing</summary><div className="mt-4">{pricingForm}</div></details>
      {custom.section(saving)}
    </fieldset></form> : <>
      <AccessRecordTabs value={tab} onChange={setTab} tabs={[
        { value: "overview", label: "Overview", content: overview },
        ...(!record.parentId ? [{ value: "subprojects", permission: "projects.read" as const, label: term("realEstate.subproject.plural", "Subprojects"), content: <ProjectList parentId={id} canManage={canManage} parentArchived={record.archived} /> }] : []),
        { value: "sales", label: "Sales", content: <ProjectSales project={{ ...record, canManage }} /> },
        ...(enabled("catalog") && can("catalogItems.read") ? [{ value: "units", label: "Units", permission: "catalogItems.read" as const, content: <CatalogList embedded extensionKey="realEstate" contextId={id} newHref={`/catalog/new?projectId=${encodeURIComponent(id)}`} /> }] : []),
        { value: "activities", permission: "activities.read" as const, label: term("crm.activity.plural", "Activities"), content: <ProjectActivities project={record} /> },
        ...(canManage ? [{ value: "team", permission: "projects.assign" as const, label: "Team", content: record.parentId ? <Section title="Staff access"><p className="text-sm text-muted-foreground">{term("realEstate.project.singular", "Staff access is inherited from the parent project.", "Staff access is inherited from the parent {label}.")}</p><Button variant="outline" asChild><Link href={`/crm/projects/${record.parentId}`}>{term("realEstate.project.singular", "Manage parent project", "Manage parent {label}")}</Link></Button></Section> : <ProjectMembers id={id} version={record.version} archived={record.archived} onVersion={version => { change("version", version); setSaved(previous => previous ? { ...previous, version } : previous) }} /> }] : []),
      ]} />
      <EditPanel open={!!editing} title={editing === "pricing" ? "Edit property and pricing" : editing === "custom" ? "Edit additional information" : term(recordKey + ".singular", "Edit project details", "Edit {label} details")} description={term("realEstate.project.singular", "Changes apply to this project only.", "Changes apply to this {label} only.")} onClose={cancelEdit} onSubmit={() => void save()} saving={saving} disabled={custom.blocked} error={error} dirty={JSON.stringify(record) !== JSON.stringify(saved) || Object.keys(custom.payload.customFields).length > 0}>
        {editing === "details" ? detailsForm : editing === "pricing" ? pricingForm : editing === "custom" ? custom.section(saving) : null}
      </EditPanel>
    </>}
    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>{current.archived ? term(recordKey + ".singular", "Restore project?", "Restore {label}?") : term(recordKey + ".singular", "Archive project?", "Archive {label}?")}</DialogTitle><DialogDescription>{current.archived ? term("realEstate.subproject.plural", "Existing staff assignments will apply again. Subprojects keep their own archive state.", "Existing staff assignments will apply again. {label} keep their own archive state.") : term("realEstate.project.singular", "Staff will lose access to this project", "Staff will lose access to this {label}") + " " + term("realEstate.subproject.plural", "and its subprojects. All records and staff assignments will be kept.", "and its {label}. All records and staff assignments will be kept.")}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void save(true)}>Confirm and save</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function ProjectMembers({ id, version, archived, onVersion }: { id: string; version: number; archived: boolean; onVersion: (version: number) => void }) {
  const term = useTerminology()
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
  return <Section title="Responsible staff and access" description={term("realEstate.project.singular", "Assigned staff can read this project", "Assigned staff can read this {label}") + " " + term("realEstate.subproject.plural", "and its active subprojects.", "and its active {label}.") + " " + term("realEstate.project.singular", "Managers can manage every project.", "Managers can manage every {label}.") + " " + term("crm.contact.singular", "Customer", "{label}") + " " + term("crm.opportunity.singular", "and opportunity access is unchanged.", "and {label} access is unchanged.")}>
    {!archived && <div className="flex flex-wrap items-end gap-3"><FormField id="project-member" label="Assign staff" className="min-w-0 flex-1 basis-52"><RecordSelect id="project-member" endpoint="/api/crm/assignees" value={selected} onChange={setSelected} disabled={saving} /></FormField><Button disabled={!selected || saving} loading={saving} onClick={() => void save(selected, false)}>Add staff</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <ul className="divide-y rounded-lg border">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm"><span>{row.name || "Unnamed staff"}{row.status !== "ACTIVE" && <span className="ml-2 text-muted-foreground">({choiceLabel(row.status)})</span>}</span>{!archived && <Button size="sm" variant="outline" disabled={saving} onClick={() => setRemove(row)}>Remove<span className="sr-only"> {row.name}</span></Button>}</li>)}{!rows.length && <li className="p-5 text-sm text-muted-foreground">{loading ? "Loading staff…" : term("realEstate.project.singular", "No staff assigned. Only managers can access this project.", "No staff assigned. Only managers can access this {label}.")}</li>}</ul>
    <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    <Dialog open={!!remove} onOpenChange={open => { if (!open && !saving) setRemove(null) }}><DialogContent><DialogHeader><DialogTitle>Remove staff access?</DialogTitle><DialogDescription>{remove?.name} {term("realEstate.project.singular", "will no longer have this project assignment. Managers retain management access.", "will no longer have this {label} assignment. Managers retain management access.")}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setRemove(null)}>Cancel</Button><Button loading={saving} onClick={() => remove && void save(remove.id, true)}>Remove access</Button></DialogFooter></DialogContent></Dialog>
  </Section>
}
