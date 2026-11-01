"use client"

import { useId, useRef, useState, type ReactNode } from "react"
import { Info, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"

/** Optional guidance only. Errors, live record values and action warnings stay inline. */
export function InfoHelp({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  const headingId = useId(), content = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const name = typeof title === "string" ? title : "More information"
  if (children === null || children === undefined || children === false || children === "") return null
  return <span className={cn("relative inline-flex size-5 shrink-0 items-center justify-center align-middle", className)}>
    <Popover open={open} onOpenChange={setOpen}>
      {/* A compact alignment slot retains a centred 32px pointer target.
          An interactive non-form trigger remains usable inside disabled fieldsets
          and does not activate an enclosing field label or submit its form. */}
      <PopoverTrigger asChild><a href="#information" role="button" onClick={event => { event.preventDefault(); setOpen(value => !value) }} onKeyDown={event => { if (event.key === " ") { event.preventDefault(); setOpen(value => !value) } }} aria-label={`About ${name}`} title={`About ${name}`} className="absolute left-1/2 top-1/2 inline-flex size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Info className="size-4" aria-hidden="true" /></a></PopoverTrigger>
      <PopoverContent ref={content} role="dialog" aria-labelledby={headingId} tabIndex={-1} align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); content.current?.focus() }} className="z-[60] flex max-h-[min(32rem,calc(100dvh-2rem),var(--radix-popover-content-available-height))] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden p-0">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3"><h3 id={headingId} className="min-w-0 break-words text-sm font-semibold">{title}</h3><PopoverPrimitive.Close asChild><button type="button" aria-label="Close information" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" aria-hidden="true" /></button></PopoverPrimitive.Close></div>
        <div role="region" aria-label={`${name} details`} tabIndex={0} className="min-h-0 space-y-3 overflow-y-auto break-words px-4 py-3 text-sm leading-6 whitespace-pre-line focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">{children}</div>
      </PopoverContent>
    </Popover>
  </span>
}
