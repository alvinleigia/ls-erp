"use client"
import { CrmSelect, CrmTextarea } from "./crm-controls"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { selectClass } from "./record-list"
import { workTypes } from "../work-validation"
import type { PlanStep } from "../plan-validation"

export function ActivityStepFields({ step, onChange, prefix, minOffset = 0, offsetLabel = "Days after start" }: { step: PlanStep; onChange: (patch: Partial<PlanStep>) => void; prefix: string; minOffset?: number; offsetLabel?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <FormField id={`${prefix}-title`} label="Title"><Input id={`${prefix}-title`} required maxLength={200} value={step.title} onChange={event => onChange({ title: event.target.value })} /></FormField>
    <FormField id={`${prefix}-type`} label="Type"><CrmSelect id={`${prefix}-type`} className={`${selectClass} w-full`} value={step.type} onValueChange={event => onChange({ type: event as PlanStep["type"], callDirection: event === "CALL" ? "OUTBOUND" : null })}>{workTypes.map(type => <option key={type}>{type}</option>)}</CrmSelect></FormField>
    <FormField id={`${prefix}-offset`} label={offsetLabel}><Input id={`${prefix}-offset`} type="number" required min={minOffset} max={365} value={step.dayOffset} onChange={event => onChange({ dayOffset: Number(event.target.value) })} /></FormField>
    <FormField id={`${prefix}-priority`} label="Priority"><CrmSelect id={`${prefix}-priority`} className={`${selectClass} w-full`} value={step.priority} onValueChange={event => onChange({ priority: Number(event) })}><option value={1}>Low</option><option value={2}>Normal</option><option value={3}>High</option></CrmSelect></FormField>
    {step.type === "CALL" && <FormField id={`${prefix}-direction`} label="Call direction"><CrmSelect id={`${prefix}-direction`} className={`${selectClass} w-full`} value={step.callDirection || "OUTBOUND"} onValueChange={event => onChange({ callDirection: event as "INBOUND" | "OUTBOUND" })}><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option></CrmSelect></FormField>}
    <FormField id={`${prefix}-reminder`} label="In-app reminder time (optional)"><Input id={`${prefix}-reminder`} type="time" value={step.reminderTime || ""} onChange={event => onChange({ reminderTime: event.target.value || null })} /></FormField>
    <FormField id={`${prefix}-instructions`} label="Staff instructions" className="sm:col-span-2"><CrmTextarea id={`${prefix}-instructions`} maxLength={5000} value={step.description} onChange={event => onChange({ description: event.target.value })} /></FormField>
  </div>
}
