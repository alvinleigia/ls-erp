"use client"
import { useBusinessModules } from "@/platform/module-provider"
import * as React from "react"
import Link from "@/platform/access/link"
import type { WorkListResponse } from "@/types/crm-work"

export function WorkReminders() {
  const { can } = useBusinessModules()
  return can("activities.read") ? <AllowedWorkReminders /> : null
}
function AllowedWorkReminders() {
  const [data, setData] = React.useState<WorkListResponse | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  React.useEffect(() => {
    let controller: AbortController | undefined
    const load = async () => {
      controller?.abort(); controller = new AbortController()
      const signal = controller.signal
      try { const response = await fetch("/api/crm/work?due=reminders&pageSize=3", { signal, cache: "no-store" }); if (!response.ok) throw new Error("Unavailable"); setData(await response.json()); setUnavailable(false) }
      catch { if (!signal.aborted) { setData(null); setUnavailable(true) } }
    }
    void load()
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load() }, 60000)
    const onFocus = () => { void load() }
    window.addEventListener("focus", onFocus)
    return () => { clearInterval(timer); controller?.abort(); window.removeEventListener("focus", onFocus) }
  }, [])
  if (unavailable) return <p className="text-xs text-muted-foreground">Reminders are temporarily unavailable. <Link className="underline" href="/crm/activities?due=reminders">Check My Work</Link></p>
  if (!data?.total) return null
  return <aside aria-label="Your activity reminders" className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm"><Link className="font-semibold underline" href="/crm/activities?due=reminders">{data.total} reminder{data.total === 1 ? "" : "s"} due</Link>{data.items.map(item => <Link className="max-w-60 truncate underline" key={item.id} href={`/crm/activities/${item.id}`}>{item.title}</Link>)}</aside>
}
