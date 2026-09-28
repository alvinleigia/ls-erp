"use client"
import { CrmSection } from "./crm-section"
import { propertySalesPipeline } from "@/modules/real-estate/pipeline-template"
import { CrmPageHeader, CrmFormActions, crmPageClass } from "./crm-page"
import { CrmCheckbox, CrmSelect } from "./crm-controls"
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useFormErrors } from "@/hooks/use-form-errors"
import type { PipelineInput } from "../sales-validation"
import type { CrmPipelineRow } from "@/types/crm"
import { selectClass } from "./record-list"

const initial: PipelineInput = { name: "Sales", archived: false, stages: [
  { name: "Qualification", kind: "OPEN", probability: 10, color: "#64748b", archived: false },
  { name: "Proposal", kind: "OPEN", probability: 40, color: "#3b82f6", archived: false },
  { name: "Negotiation", kind: "OPEN", probability: 70, color: "#a855f7", archived: false },
  { name: "Won", kind: "WON", probability: 100, color: "#16a34a", archived: false },
  { name: "Lost", kind: "LOST", probability: 0, color: "#dc2626", archived: false },
] }

export function PipelineEditor({ id, propertyTemplate = false }: { id?: string; propertyTemplate?: boolean }) {
  const router = useRouter()
  const [record, setRecord] = React.useState<CrmPipelineRow | null>(null)
  const [values, setValues] = React.useState<PipelineInput>(!id && propertyTemplate ? propertySalesPipeline : initial)
  const [canManage, setCanManage] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [confirm, setConfirm] = React.useState(false)
  const { errors, setErrorsFromResponse, clearErrors } = useFormErrors()
  React.useEffect(() => {
    const controller = new AbortController()
    void fetch(id ? `/api/crm/pipelines/${id}` : "/api/crm/pipelines?pageSize=1", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load pipeline.")
      setCanManage(data.canManage)
      if (id) { setRecord(data); setValues({ name: data.name, archived: data.archived, stages: data.stages.map(({ id, name, kind, probability, color, archived }: CrmPipelineRow["stages"][number]) => ({ id, name, kind, probability, color, archived })) }) }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  const updateStage = (index: number, fields: Partial<PipelineInput["stages"][number]>) => setValues(previous => ({ ...previous, stages: previous.stages.map((stage, at) => at === index ? { ...stage, ...fields } : stage) }))
  function reorder(index: number, offset: number) {
    setValues(previous => { const stages = [...previous.stages]; [stages[index], stages[index + offset]] = [stages[index + offset], stages[index]]; return { ...previous, stages } })
  }
  async function persist() {
    setSaving(true); setError(""); clearErrors()
    try {
      const response = await fetch(id ? `/api/crm/pipelines/${id}` : "/api/crm/pipelines", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, ...(id ? { version: record?.version } : {}) }) })
      const data = await response.json()
      if (!response.ok) { setErrorsFromResponse(data); throw new Error(data.error || "Unable to save pipeline.") }
      toast.success("Pipeline saved."); setConfirm(false)
      if (!id) router.push(`/crm/pipelines/${data.id}`)
      else { setRecord(data); setValues({ name: data.name, archived: data.archived, stages: data.stages.map(({ id, name, kind, probability, color, archived }: CrmPipelineRow["stages"][number]) => ({ id, name, kind, probability, color, archived })) }) }
    } catch (error) { setError((error as Error).message); setConfirm(false) } finally { setSaving(false) }
  }
  if (loading) return <p>Loading pipeline…</p>
  return <div className={crmPageClass}>
    <form id="pipeline-form" className="space-y-5" onSubmit={event => { event.preventDefault(); if (record && ((!record.archived && values.archived) || values.stages.some(stage => stage.archived && record.stages.some(old => old.id === stage.id && !old.archived)))) setConfirm(true); else void persist() }}>
      <CrmPageHeader title={id ? "Configure pipeline" : "New pipeline"} backHref="/crm/pipelines" backLabel="Back to pipelines" actions={<CrmFormActions form="pipeline-form" cancelHref="/crm/pipelines" saving={saving} disabled={false} canSave={canManage} saveLabel="Save pipeline" />} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!canManage && <p>Only managers and administrators can configure pipelines.</p>}
      <CrmSection title="Pipeline configuration" description="Stages define your board. Keep at least one open, won and lost stage."><fieldset disabled={!canManage || saving} className="space-y-5">
        <FormField id="pipeline-name" label="Pipeline name" error={errors.name}><Input id="pipeline-name" required maxLength={100} value={values.name} onChange={event => setValues({ ...values, name: event.target.value })} /></FormField>
        <label className="flex items-center gap-2 text-sm"><CrmCheckbox  checked={values.archived} onChange={event => setValues({ ...values, archived: event.target.checked })} />Archive pipeline</label>
        <p className="text-sm text-muted-foreground">Stages define the board columns. Keep at least one open, won and lost stage. Existing deals keep their probability until edited or moved; archiving preserves deals and history.</p>
        {errors.stages && <p role="alert" className="text-destructive">{errors.stages}</p>}
        {values.stages.map((stage, index) => <div key={stage.id || `new-${index}`} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{index + 1}. {stage.name || "New stage"}</h2><div className="flex gap-2"><Button type="button" variant="outline" size="sm" aria-label={`Move ${stage.name} up`} disabled={index === 0} onClick={() => reorder(index, -1)}>↑</Button><Button type="button" variant="outline" size="sm" aria-label={`Move ${stage.name} down`} disabled={index === values.stages.length - 1} onClick={() => reorder(index, 1)}>↓</Button>{!stage.id && <Button type="button" variant="outline" size="sm" onClick={() => setValues({ ...values, stages: values.stages.filter((_, at) => at !== index) })}>Remove new stage</Button>}</div></div>
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField id={`stage-name-${index}`} label="Name"><Input id={`stage-name-${index}`} required maxLength={80} value={stage.name} onChange={event => updateStage(index, { name: event.target.value })} /></FormField>
            <FormField id={`stage-kind-${index}`} label="Outcome type"><CrmSelect id={`stage-kind-${index}`} className={`${selectClass} w-full`} value={stage.kind} onValueChange={event => { const kind = event as "OPEN" | "WON" | "LOST"; updateStage(index, { kind, probability: kind === "WON" ? 100 : kind === "LOST" ? 0 : 10 }) }}><option>OPEN</option><option>WON</option><option>LOST</option></CrmSelect></FormField>
            <FormField id={`probability-${index}`} label="Default probability %"><Input id={`probability-${index}`} type="number" min={0} max={stage.kind === "OPEN" ? 99 : 100} required disabled={stage.kind !== "OPEN"} value={stage.probability} onChange={event => updateStage(index, { probability: Number(event.target.value) })} /></FormField>
            <FormField id={`color-${index}`} label="Colour"><Input id={`color-${index}`} type="color" value={stage.color} onChange={event => updateStage(index, { color: event.target.value })} /></FormField>
          </div>
          <label className="flex items-center gap-2 text-sm"><CrmCheckbox  checked={stage.archived} onChange={event => updateStage(index, { archived: event.target.checked })} />Archived stage</label>
        </div>)}
        <Button type="button" variant="outline" disabled={values.stages.length >= 30} onClick={() => setValues({ ...values, stages: [...values.stages, { name: "", kind: "OPEN", probability: 10, color: "#64748b", archived: false }] })}>Add stage</Button>
      </fieldset></CrmSection>
    </form>
    <Dialog open={confirm} onOpenChange={open => { if (!saving) setConfirm(open) }}><DialogContent><DialogHeader><DialogTitle>Archive this pipeline or its stages?</DialogTitle><DialogDescription>Existing opportunities and their history will remain. New opportunities cannot enter archived stages or pipelines.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={saving} onClick={() => void persist()}>Save and archive</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
