"use client"

import * as React from "react"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { cn } from "@/lib/utils"

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children).map(child => React.isValidElement<{ children?: React.ReactNode }>(child) ? optionText(child.props.children) : String(child)).join("")
}
function choices(children: React.ReactNode): { value: string; label: string; disabled?: boolean }[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<React.ComponentProps<"option">>(child)) return []
    if (child.type === React.Fragment) return choices(child.props.children)
    const label = optionText(child.props.children)
    return [{ value: String(child.props.value ?? label), label, disabled: child.props.disabled }]
  })
}

/** Fixed choices use Radix menus; the native field preserves HTML form validation. */
export function CrmSelect({ id, value, onValueChange, children, disabled, required, name, className, "aria-label": label }: {
  id?: string; value: string | number; onValueChange: (value: string) => void; children: React.ReactNode;
  disabled?: boolean; required?: boolean; name?: string; className?: string; "aria-label"?: string;
}) {
  const generatedId = React.useId()
  const controlId = id || generatedId
  const [invalid, setInvalid] = React.useState(false)
  return <span className={cn("relative inline-block min-w-0", className?.includes("w-full") && "w-full")}>
    <DropdownSelect id={controlId} label={label} value={String(value)} options={choices(children)} disabled={disabled} invalid={invalid && !value} className={cn("w-full", className)} onValueChange={next => { setInvalid(false); onValueChange(next) }} />
    <select hidden aria-hidden="true" tabIndex={-1} name={name} value={value} disabled={disabled} required={required} onChange={event => onValueChange(event.target.value)} onInvalid={event => { event.preventDefault(); setInvalid(true); document.getElementById(controlId)?.focus() }}>{children}</select>
    {invalid && !value && <span className="mt-1 block text-xs text-destructive" role="alert">Choose an option.</span>}
  </span>
}

export function CrmTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={cn("min-h-24 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)} />
}

export function CrmCheckbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return <input {...props} type="checkbox" className={cn("size-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)} />
}
