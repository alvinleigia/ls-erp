"use client"
import { useCrmRecordView } from "./crm-record-view"

import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Search, SlidersHorizontal } from "lucide-react"
import type { Table } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export const crmPageClass = "mx-auto w-full min-w-0 max-w-6xl space-y-6"

export function CrmSurface({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5", className)}>{children}</div>
}

export function CrmPageHeader({ title, description, backHref, backLabel = "Back", actions, badge }: {
  title: ReactNode; description?: ReactNode; backHref?: string; backLabel?: string; actions?: ReactNode; badge?: ReactNode;
}) {
  return <header className="space-y-4">
    {backHref && <Link href={backHref} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{backLabel}</Link>}
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</h1>{badge}</div>{description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>}</div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  </header>
}

export function CrmFormActions({ form, cancelHref, saving, disabled, canSave = true, saveLabel, loadingText = "Saving…", children }: {
  form: string; cancelHref: string; saving?: boolean; disabled?: boolean; canSave?: boolean; saveLabel: string; loadingText?: string; children?: ReactNode;
}) {
  const router = useRouter()
  const view = useCrmRecordView()
  if (view?.existing) return <>{children}{canSave && <Button type="button" disabled={disabled || saving} onClick={() => view.begin()}>Edit details</Button>}</>
  return <>{children}{canSave && <><Button type="button" variant="outline" disabled={saving} onClick={() => router.push(cancelHref)}>Cancel</Button><Button type="submit" form={form} loading={saving} loadingText={loadingText} disabled={disabled}>{saveLabel}</Button></>}</>
}

export function CrmActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t pt-4", className)}>{children}</div>
}

export function CrmFilters({ children, activeCount = 0, onReset, label = "Filters" }: { children: ReactNode; activeCount?: number; onReset?: () => void; label?: string }) {
  return <Popover><PopoverTrigger asChild><Button type="button" variant="outline"><SlidersHorizontal className="size-4" aria-hidden="true" />Filters{activeCount > 0 && <span className="rounded bg-secondary px-1.5 text-xs">{activeCount}</span>}</Button></PopoverTrigger><PopoverContent align="end" aria-label={label} className="max-h-[min(32rem,80vh)] w-[min(26rem,calc(100vw-2rem))] space-y-4 overflow-y-auto p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{label}</h3>{onReset && <Button type="button" size="sm" variant="ghost" onClick={onReset}>Reset filters</Button>}</div><div className="grid grid-cols-1 gap-4 min-[440px]:grid-cols-2">{children}</div></PopoverContent></Popover>
}

export function CrmTableToolbar<T>({ table, searchPlaceholder = "Search…", children }: { table: Table<T>; searchPlaceholder?: string; showColumnToggle?: boolean; children?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2"><div className="relative min-w-0 basis-full sm:basis-56 sm:flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label={searchPlaceholder} className="pl-9" placeholder={searchPlaceholder} value={String(table.getState().globalFilter ?? "")} onChange={event => table.setGlobalFilter(event.target.value)} /></div>{children}</div>
}
