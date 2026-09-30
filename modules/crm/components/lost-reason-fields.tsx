"use client"
import Link from "@/platform/access/link"
import { FormField } from "@/components/form-field"
import { RecordSelect } from "./record-select"
import { CrmTextarea } from "./crm-controls"

export function LostReasonFields({ value, name, note, onReasonChange, onNoteChange, legacy = false }: {
  value: string; name?: string | null; note: string; legacy?: boolean;
  onReasonChange: (id: string) => void; onNoteChange: (note: string) => void;
}) {
  return <div className="space-y-4 sm:col-span-2">
    <FormField id="lostReasonId" label="Lost reason">
      <RecordSelect id="lostReasonId" endpoint="/api/crm/lost-reasons" value={value}
        selected={value && name ? { value, label: name } : undefined}
        onChange={onReasonChange} placeholder="Choose a lost reason" />
      <p className="text-xs text-muted-foreground">{legacy ? "This older record has no structured reason. Its existing note is preserved." : "Required when marking this record Lost."} <Link href="/crm/lost-reasons" target="_blank" rel="noreferrer" className="underline">Manage lost reasons</Link></p>
    </FormField>
    <FormField id="closing-note" label="Closing note (optional)">
      <CrmTextarea id="closing-note" maxLength={2000} value={note} onChange={e => onNoteChange(e.target.value)} />
    </FormField>
  </div>
}

export function LostReasonFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return <FormField id="lost-reason-filter" label="Lost reason">
    <RecordSelect id="lost-reason-filter" endpoint="/api/crm/lost-reasons?includeArchived=true" value={value} onChange={onChange} placeholder="All reasons" />
    {value && <button type="button" className="text-xs underline" onClick={() => onChange("")}>Clear reason</button>}
  </FormField>
}
