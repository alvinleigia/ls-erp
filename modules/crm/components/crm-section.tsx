"use client"

import { useId, type ReactNode } from "react"
import { FileText, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function CrmSection({ title, description, icon: Icon = FileText, actions, children, className, id }: {
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  const headingId = useId()
  return <section id={id} aria-labelledby={headingId} className={cn("min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm", className)}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-lg border bg-background p-2 text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></div>
        <div className="min-w-0"><h2 id={headingId} className="text-base font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    <div className="space-y-4 p-4 sm:p-5">{children}</div>
  </section>
}

export function CrmEmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-lg border border-dashed bg-muted/10 px-4 py-8 text-center">
    <p className="text-sm font-medium">{title}</p>
    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
  </div>
}
