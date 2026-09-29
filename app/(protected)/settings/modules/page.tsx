"use client"
import * as React from "react"
import { moduleChangeProblem, type BusinessModuleKey } from "@/platform/modules"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"

type Module = { key: BusinessModuleKey; parent?: string; name: string; description: string; enabled: boolean; href: string }
export default function ModulesPage() {
  const [modules, setModules] = React.useState<Module[]>([])
  const [canManage, setCanManage] = React.useState(false)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [pending, setPending] = React.useState<Module | null>(null)
  React.useEffect(() => {
    const controller = new AbortController()
    fetch("/api/modules", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load modules.")
      setModules(data.modules); setCanManage(data.canManage)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  async function save(module: Module) {
    setSaving(true)
    try {
      const response = await fetch("/api/modules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: module.key, enabled: !module.enabled }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to update module.")
      setModules(items => items.map(item => item.key === module.key ? { ...item, enabled: data.enabled } : item))
      window.dispatchEvent(new Event("business-modules-changed"))
      setPending(null); toast.success(`${module.name} ${data.enabled ? "enabled" : "disabled"}.`)
    } catch (error) { toast.error((error as Error).message) } finally { setSaving(false) }
  }
  return <div className="mx-auto max-w-3xl space-y-6">
    <div><h1 className="text-2xl font-semibold">Business modules</h1><p className="text-muted-foreground">Choose the capabilities available in this workspace.</p></div>
    {loading && <p>Loading modules…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {modules.map(module => {
      const problem = moduleChangeProblem(modules, module.key, !module.enabled)
      return <div key={module.key} className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 ${module.parent ? "sm:ml-8" : ""}`}>
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{module.name} - {module.enabled ? "Enabled" : "Disabled"}</h2><p className="text-sm text-muted-foreground">{module.description}</p>{problem && <p className="mt-2 text-sm text-muted-foreground">{problem}</p>}</div>
        <div className="flex gap-2">{module.enabled && !module.parent && <Button variant="outline" asChild><Link href={module.href}>Open {module.name}</Link></Button>}
          {canManage && <Button loading={saving} disabled={!!problem} onClick={() => module.enabled ? setPending(module) : void save(module)}>{module.enabled ? "Disable" : "Enable"}</Button>}
        </div>
      </div>
    })}
    {!loading && !error && !canManage && <p className="text-sm text-muted-foreground">Ask a business administrator to change enabled modules.</p>}
    <Dialog open={!!pending} onOpenChange={open => { if (!saving && !open) setPending(null) }}><DialogContent>
      <DialogHeader><DialogTitle>Disable {pending?.name}?</DialogTitle><DialogDescription>{pending?.parent ? "New instalment schedules and edits to scheduled documents will be disabled. Saved versions remain readable and downloadable." : "Users will lose access to this module. Its records will be kept and become available when it is enabled again."}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setPending(null)}>Cancel</Button><Button loading={saving} onClick={() => pending && void save(pending)}>Disable module</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}
