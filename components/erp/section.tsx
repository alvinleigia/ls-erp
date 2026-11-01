"use client"

import { useId, useContext, type ReactNode } from "react"
import { EditSectionContext } from "./edit-sections"
import { FileText, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { InfoHelp } from "./info-help"

export function Section({ title, description, descriptionDisplay = "help", icon: Icon = FileText, actions, children, className, id, sectionKey }: {
  title: ReactNode
  description?: ReactNode
  descriptionDisplay?: "help" | "inline"
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  sectionKey?: string
  id?: string
}) {
  const headingId = useId()
  const edit = useContext(EditSectionContext)
  const identity = sectionKey ?? title
  if (edit && typeof title === "string") return <div className={cn("relative min-w-0 rounded-xl border bg-card", className)}>
    <details open={edit.active === identity} onToggle={event => { if (event.currentTarget.open && edit.active !== identity) edit.setActive(identity as string) }}>
      <summary className="cursor-pointer p-4 pr-14 text-sm font-semibold" onClick={event => { event.preventDefault(); edit.setActive(edit.active === identity ? "" : identity as string) }}>{title}</summary>
      <div className="space-y-4 border-t p-4">{description && descriptionDisplay === "inline" && <div className="text-sm text-muted-foreground">{description}</div>}{actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}{children}</div>
    </details>
    {description && descriptionDisplay === "help" && <InfoHelp title={title} className="absolute right-4 top-4">{description}</InfoHelp>}
  </div>
  return <section id={id} aria-labelledby={headingId} className={cn("min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm", className)}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-4 sm:px-5">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <div className="rounded-lg border bg-background p-2 text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></div>
        <div className="flex min-w-0 items-center gap-2"><h2 id={headingId} className="min-w-0 break-words text-base font-semibold">{title}</h2>{description && descriptionDisplay === "help" && <InfoHelp title={title}>{description}</InfoHelp>}</div>
        {description && descriptionDisplay === "inline" && <div className="col-start-2 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    <div className="space-y-4 p-4 sm:p-5">{children}</div>
  </section>
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-lg border border-dashed bg-muted/10 px-4 py-8 text-center">
    <p className="text-sm font-medium">{title}</p>
    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
  </div>
}
