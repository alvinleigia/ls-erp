"use client"
import * as React from "react"
import Link from "@/platform/access/link"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Project } from "@/types/real-estate"

// Fetch only expanded branches, in bounded pages. Never download a tenant tree
// merely to build a selector or display the first screen.
export function ProjectTree({ items }: { items: Project[] }) {
  return <ul aria-label="Project hierarchy" className="divide-y rounded-xl border">{items.map(row => <Branch key={row.id} row={row} />)}</ul>
}
function Branch({ row }: { row: Project }) {
  const [expanded, setExpanded] = React.useState(false), [children, setChildren] = React.useState<Project[]>([])
  const [page, setPage] = React.useState(0), [total, setTotal] = React.useState(0), [loading, setLoading] = React.useState(false), [error, setError] = React.useState("")
  const request = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => request.current?.abort(), [])
  async function load(next: number) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setLoading(true); setError("")
    try {
      const response = await fetch(`/api/real-estate/projects?parentId=${encodeURIComponent(row.id)}&page=${next}&pageSize=20`, { signal: controller.signal, cache: "no-store" })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to load this branch.")
      if (!controller.signal.aborted) { setChildren(previous => next === 1 ? result.items : [...previous, ...result.items]); setTotal(result.total); setPage(next) }
    } catch (error) { if (!controller.signal.aborted) setError((error as Error).message) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  return <li className="min-w-0 p-3">
    <div className="flex min-w-0 items-center gap-2">
      <Button type="button" variant="ghost" size="icon" aria-label={`${expanded ? "Collapse" : "Expand"} ${row.name}`} aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded && !page) void load(1) }}>{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button>
      <Link className="min-w-0 break-words font-medium underline underline-offset-4" href={`/crm/projects/${row.id}`}>{row.name}</Link>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{row.code}</span>
    </div>
    {expanded && <div className="ml-3 border-l pl-3">
      {children.length > 0 && <ul className="divide-y">{children.map(child => <Branch key={child.id} row={child} />)}</ul>}
      {loading && <p role="status" className="p-3 text-sm text-muted-foreground">Loading…</p>}
      {!loading && !error && page > 0 && !children.length && <p className="p-3 text-sm text-muted-foreground">No active child projects.</p>}
      {error && <p role="alert" className="p-3 text-sm text-destructive">{error} <Button variant="link" size="sm" onClick={() => void load(page + 1)}>Retry</Button></p>}
      {!loading && children.length < total && <Button variant="outline" size="sm" onClick={() => void load(page + 1)}>Load more</Button>}
    </div>}
  </li>
}
