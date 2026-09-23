"use client"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { selectClass } from "./record-list"
import { workTypes } from "../work-validation"
import type { PlanStep } from "../plan-validation"

export function ActivityStepFields({ step, onChange, prefix, minOffset = 0, offsetLabel = "Days after start" }: { step: PlanStep; onChange: (patch: Partial<PlanStep>) => void; prefix: string; minOffset?: number; offsetLabel?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <FormField id={`${prefix}-title`} label="Title"><Input id={`${prefix}-title`} required maxLength={200} value={step.title} onChange={event => onChange({ title: event.target.value })} /></FormField>
    <FormField id={`${prefix}-type`} label="Type"><select id={`${prefix}-type`} className={`${selectClass} w-full`} value={step.type} onChange={event => onChange({ type: event.target.value as PlanStep["type"], callDirection: event.target.value === "CALL" ? "OUTBOUND" : null })}>{workTypes.map(type => <option key={type}>{type}</option>)}</select></FormField>
    <FormField id={`${prefix}-offset`} label={offsetLabel}><Input id={`${prefix}-offset`} type="number" required min={minOffset} max={365} value={step.dayOffset} onChange={event => onChange({ dayOffset: Number(event.target.value) })} /></FormField>
    <FormField id={`${prefix}-priority`} label="Priority"><select id={`${prefix}-priority`} className={`${selectClass} w-full`} value={step.priority} onChange={event => onChange({ priority: Number(event.target.value) })}><option value={1}>Low</option><option value={2}>Normal</option><option value={3}>High</option></select></FormField>
    {step.type === "CALL" && <FormField id={`${prefix}-direction`} label="Call direction"><select id={`${prefix}-direction`} className={`${selectClass} w-full`} value={step.callDirection || "OUTBOUND"} onChange={event => onChange({ callDirection: event.target.value as "INBOUND" | "OUTBOUND" })}><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option></select></FormField>}
    <FormField id={`${prefix}-reminder`} label="In-app reminder time (optional)"><Input id={`${prefix}-reminder`} type="time" value={step.reminderTime || ""} onChange={event => onChange({ reminderTime: event.target.value || null })} /></FormField>
    <FormField id={`${prefix}-instructions`} label="Staff instructions" className="sm:col-span-2"><textarea id={`${prefix}-instructions`} maxLength={5000} className="min-h-20 w-full rounded border p-3" value={step.description} onChange={event => onChange({ description: event.target.value })} /></FormField>
  </div>
}
