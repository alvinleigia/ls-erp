"use client"
import { CrmSelect, CrmCheckbox, CrmTextarea } from "./crm-controls"
import { Input } from "@/components/ui/input"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "./record-select"
import { selectClass } from "./record-list"
import { workTypes, type WorkScheduleInput } from "../work-validation"
import { wallTime, wallTimeToInstant } from "../work-time"
import type { CrmWorkRow, WorkType } from "@/types/crm-work"

export type WorkFormValues = { title: string; type: WorkType; assignedUserId: string; priority: number; description: string; dueOn: string; startsLocal: string; endsLocal: string; reminderLocal: string; callDirection: "INBOUND" | "OUTBOUND" | null }
export const emptyWork: WorkFormValues = { title: "", type: "TASK", assignedUserId: "", priority: 2, description: "", dueOn: "", startsLocal: "", endsLocal: "", reminderLocal: "", callDirection: null }
export function workForm(record: CrmWorkRow, timeZone: string): WorkFormValues {
  return { title: record.title, type: record.type, assignedUserId: record.assignedUserId, priority: record.priority, description: record.description || "", dueOn: record.dueOn.slice(0, 10), startsLocal: record.startsAt ? wallTime(record.startsAt, timeZone) : "", endsLocal: record.endsAt ? wallTime(record.endsAt, timeZone) : "", reminderLocal: record.reminderAt ? wallTime(record.reminderAt, timeZone) : "", callDirection: record.callDirection }
}
export function workPayload(values: WorkFormValues, timeZone: string): WorkScheduleInput {
  const { startsLocal, endsLocal, reminderLocal, ...rest } = values
  return { ...rest, dueOn: startsLocal ? startsLocal.slice(0, 10) : rest.dueOn, startsAt: startsLocal ? wallTimeToInstant(startsLocal, timeZone) : null, endsAt: endsLocal ? wallTimeToInstant(endsLocal, timeZone) : null, reminderAt: reminderLocal ? wallTimeToInstant(reminderLocal, timeZone) : null }
}
export function WorkScheduleFields({ values, onChange, prefix = "work", canAssign, assignee, timeZone, errors = {}, logOnly = false }: {
  values: WorkFormValues; onChange: (values: WorkFormValues) => void; prefix?: string; canAssign: boolean; assignee?: { id: string; name: string | null }; timeZone: string; errors?: Record<string, string>; logOnly?: boolean;
}) {
  const field = (name: string) => `${prefix}-${name}`
  return <div className="grid gap-4 sm:grid-cols-2">
    <FormField id={field("title")} label="Activity title" error={errors.title} className="sm:col-span-2"><Input id={field("title")} required maxLength={200} value={values.title} onChange={event => onChange({ ...values, title: event.target.value })} /></FormField>
    <FormField id={field("type")} label="Activity type" error={errors.type}><CrmSelect id={field("type")} className={`${selectClass} w-full`} value={values.type} onValueChange={event => { const type = event as WorkType; onChange({ ...values, type, callDirection: type === "CALL" ? "OUTBOUND" : null }) }}>{workTypes.map(type => <option key={type}>{type}</option>)}</CrmSelect></FormField>
    <FormField id={field("assignee")} label="Assigned staff" error={errors.assignedUserId}><RecordSelect id={field("assignee")} endpoint="/api/crm/assignees" value={values.assignedUserId} selected={assignee ? { value: assignee.id, label: assignee.name || "Staff member" } : undefined} onChange={assignedUserId => onChange({ ...values, assignedUserId })} disabled={!canAssign} /></FormField>
    <FormField id={field("priority")} label="Priority"><CrmSelect id={field("priority")} className={`${selectClass} w-full`} value={values.priority} onValueChange={event => onChange({ ...values, priority: Number(event) })}><option value={1}>Low</option><option value={2}>Normal</option><option value={3}>High</option></CrmSelect></FormField>
    {values.type === "CALL" && <FormField id={field("direction")} label="Call direction" error={errors.callDirection}><CrmSelect id={field("direction")} className={`${selectClass} w-full`} value={values.callDirection || "OUTBOUND"} onValueChange={event => onChange({ ...values, callDirection: event as "INBOUND" | "OUTBOUND" })}><option value="OUTBOUND">Outbound</option><option value="INBOUND">Inbound</option></CrmSelect></FormField>}
    {!logOnly && <>
      <FormField id={field("due")} label="Due date" error={errors.dueOn}><Input id={field("due")} type="date" required value={values.dueOn} disabled={!!values.startsLocal} onChange={event => onChange({ ...values, dueOn: event.target.value })} /></FormField>
      <label className="flex items-center gap-2 text-sm"><CrmCheckbox  checked={!!values.startsLocal} onChange={event => onChange({ ...values, startsLocal: event.target.checked ? `${values.dueOn || wallTime(new Date(), timeZone).slice(0, 10)}T09:00` : "", endsLocal: event.target.checked ? `${values.dueOn || wallTime(new Date(), timeZone).slice(0, 10)}T09:30` : "" })} />Schedule a specific time ({timeZone})</label>
      {values.startsLocal && <><FormField id={field("start")} label={`Start (${timeZone})`} error={errors.startsAt}><Input id={field("start")} type="datetime-local" required value={values.startsLocal} onChange={event => onChange({ ...values, startsLocal: event.target.value, dueOn: event.target.value.slice(0, 10) })} /></FormField><FormField id={field("end")} label="End" error={errors.endsAt}><Input id={field("end")} type="datetime-local" required value={values.endsLocal} onChange={event => onChange({ ...values, endsLocal: event.target.value })} /></FormField></>}
      <FormField id={field("reminder")} label={`In-app reminder (${timeZone}, optional)`} error={errors.reminderAt}><Input id={field("reminder")} type="datetime-local" value={values.reminderLocal} onChange={event => onChange({ ...values, reminderLocal: event.target.value })} /></FormField>
    </>}
    <FormField id={field("description")} label="Staff instructions / preparation" error={errors.description} className="sm:col-span-2"><CrmTextarea id={field("description")} maxLength={5000} value={values.description} onChange={event => onChange({ ...values, description: event.target.value })} /></FormField>
  </div>
}
