"use client"

import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight, Quote, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export type CrmTimelineEntry = {
  id: string
  icon: LucideIcon
  actor: string
  action: string
  dateTime: string
  timeLabel: string
  detail: ReactNode
}

export function CrmTimeline({ entries }: { entries: CrmTimelineEntry[] }) {
  return <ol className="space-y-4" aria-label="Timeline entries">
    {entries.map(({ id, icon: Icon, actor, action, dateTime, timeLabel, detail }) => <li key={id} className="group relative min-w-0 pl-11 sm:pl-12">
      <span aria-hidden="true" className="absolute -bottom-8 left-4 top-8 w-px bg-border group-last:hidden" />
      <span aria-hidden="true" className="absolute left-0 top-4 flex size-8 items-center justify-center rounded-full border bg-background text-muted-foreground group-first:border-sky-600 group-first:bg-sky-600 group-first:text-white"><Icon className="size-4" /></span>
      <article className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-sm">
        <header className="flex items-start gap-3 px-3 py-4 sm:px-4">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">{actor.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
          <div className="min-w-0 space-y-1">
            <p className="break-words text-sm"><span className="font-semibold">{actor}</span> <span className="text-muted-foreground">{action}</span></p>
            <time dateTime={dateTime} className="block text-xs text-muted-foreground">{timeLabel}</time>
          </div>
        </header>
        <div className="flex items-start gap-2.5 border-t bg-muted/20 px-3 py-3 sm:px-4">
          <Quote aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-2 text-sm">{detail}</div>
        </div>
      </article>
    </li>)}
  </ol>
}

export function TimelinePagination({ label, page, totalPages, loading, onPageChange }: {
  label: string
  page: number
  totalPages: number
  loading: boolean
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1 && page <= 1) return null
  return <nav aria-label={label} className="flex items-center justify-center gap-3 border-t pt-4">
    <Button variant="outline" size="icon" aria-label="Previous page" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft aria-hidden="true" /></Button>
    <span className="text-sm text-muted-foreground" aria-live="polite">Page {page} of {Math.max(1, totalPages)}</span>
    <Button variant="outline" size="icon" aria-label="Next page" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight aria-hidden="true" /></Button>
  </nav>
}
