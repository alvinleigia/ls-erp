"use client"

import { useId } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/** A labelled, single-choice dropdown for small, fixed option lists. */
export function DropdownSelect({ id, label, value, options, onValueChange, disabled, className, invalid }: {
  id?: string
  label?: string
  value: string
  options: readonly { value: string; label: string; disabled?: boolean }[]
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
  invalid?: boolean
}) {
  const selectedId = useId()
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button id={id} type="button" variant="outline" disabled={disabled} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={selectedId} className={cn("min-w-0 justify-between font-normal", className)}>
        <span id={selectedId} className="truncate">{options.find(option => option.value === value)?.label ?? value}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
      {label && <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>}
      <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
        {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
