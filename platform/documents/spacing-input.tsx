"use client"
import { useId, useState } from "react"

export function SpacingInput({ label, value, min, max, step, disabled, onChange }: { label: string; value: number | undefined; min: number; max: number; step: number; disabled: boolean; onChange: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value)), [invalid, setInvalid] = useState(false), id=useId()
  function commit() {
    const number = draft === "" ? null : Number(draft)
    if (number !== null && (!Number.isFinite(number) || number < min || number > max)) { setInvalid(true); return }
    setInvalid(false); if (number !== (value ?? null)) onChange(number)
  }
  return <label className="relative flex max-w-full flex-col items-start gap-2 text-sm font-medium"><span>{label}</span><input aria-label={label} aria-invalid={invalid || undefined} aria-describedby={invalid?id:undefined} type="number" min={min} max={max} step={step} placeholder="Default" disabled={disabled} value={draft} className="h-10 w-28 max-w-full rounded-md border bg-background px-3 font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event=>{setDraft(event.target.value);setInvalid(false)}} onBlur={commit} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();commit()}else if(event.key==="Escape"){event.preventDefault();setDraft(value===undefined?"":String(value));setInvalid(false)}}}/>{invalid&&<span id={id} role="alert" className="absolute left-0 top-full z-10 rounded border bg-background p-1 text-destructive">Use {min}–{max}.</span>}</label>
}
