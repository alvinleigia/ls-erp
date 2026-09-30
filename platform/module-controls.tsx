"use client"
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { businessModules, moduleKeys, moduleChangeProblem, moduleAllowanceProblem, type BusinessModuleKey } from "./modules"

type Module = { key: BusinessModuleKey; parent?: string; name: string; description: string; allowed: boolean; enabled: boolean; href: string }

export function ModuleControls({ tenantId }: { tenantId?: string }) {
  const platform = !!tenantId
  const endpoint = tenantId ? `/api/tenants/${encodeURIComponent(tenantId)}/modules` : "/api/modules"
  const [modules, setModules] = React.useState<Module[]>([])
  const [canManage, setCanManage] = React.useState(false)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [pending, setPending] = React.useState<Module | null>(null)
  const load = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { signal, cache: "no-store" })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Unable to load modules.")
    setModules(data.modules); setCanManage(platform || data.canManage); setError("")
  }, [endpoint, platform])
  React.useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load])
  async function save(module: Module) {
    setSaving(true)
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: module.key, ...(platform ? { allowed: !module.allowed } : { enabled: !module.enabled }) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to update module.")
      setPending(null)
      if (!platform) window.dispatchEvent(new Event("business-modules-changed"))
      await load()
      toast.success("Module settings saved.")
    } catch (error) { toast.error((error as Error).message); await load().catch(() => {}) }
    finally { setSaving(false) }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{platform ? "Allow modules for this tenant. Newly allowed modules start enabled when their dependencies are enabled. The tenant administrator can switch them off." : "Enable or disable the modules allowed by your platform administrator. Your data is kept when a module is disabled."}</p>
    {loading && <p>Loading modules...</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {modules.map(module => {
      const active = platform ? module.allowed : module.enabled
      const problem = platform ? moduleAllowanceProblem(modules, module.key, !active) : module.allowed ? moduleChangeProblem(modules, module.key, !active) : null
      const label = platform ? active ? "Remove allowance" : "Allow" : active ? "Disable" : "Enable"
      return <section aria-label={module.name} key={module.key} className={`flex flex-col items-stretch justify-between gap-4 rounded-xl border p-5 sm:flex-row sm:items-center ${module.parent ? "sm:ml-8" : ""}`}>
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{module.name}</h2><p className="text-sm text-muted-foreground">{module.description}</p>
          <p className="mt-2 text-sm font-medium">{!module.allowed ? "Not allowed by platform" : module.enabled ? "Allowed · Enabled" : "Allowed · Disabled by tenant"}</p>
          {problem && <p className="mt-2 text-sm text-muted-foreground">{problem}</p>}
        </div>
        <div className="flex flex-wrap gap-2">{!platform && module.enabled && !module.parent && <Button variant="outline" asChild><Link href={module.href}>Open {module.name}</Link></Button>}
          {canManage && (platform || module.allowed) && <Button variant={active ? "outline" : "default"} loading={saving} disabled={!!problem} aria-label={`${label} ${module.name}`} onClick={() => active ? setPending(module) : void save(module)}>{label}</Button>}
        </div>
      </section>
    })}
    {!loading && !error && !canManage && <p className="text-sm text-muted-foreground">Ask a business administrator to change enabled modules.</p>}
    <Dialog open={!!pending} onOpenChange={open => { if (!saving && !open) setPending(null) }}><DialogContent>
      <DialogHeader><DialogTitle>{platform ? "Remove allowance for" : "Disable"} {pending?.name}?</DialogTitle><DialogDescription>
        {pending?.parent ? "New instalment schedules and edits to scheduled documents will be disabled. Saved versions remain readable and downloadable." : "Users will lose access to this module. Its records will be kept."}
        {platform ? " The tenant administrator cannot enable it again until you allow it." : " You can enable it again while the platform allows it."}
      </DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setPending(null)}>Cancel</Button><Button loading={saving} onClick={() => pending && void save(pending)}>{platform ? "Remove allowance" : "Disable module"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}

export function TenantModuleSelection({ value, onChange, disabled }: { value: BusinessModuleKey[]; onChange: (value: BusinessModuleKey[]) => void; disabled?: boolean }) {
  const flags = moduleKeys.map(key => ({ key, allowed: value.includes(key), enabled: value.includes(key) }))
  return <fieldset className="space-y-3 rounded-lg border p-4" disabled={disabled}>
    <legend className="px-1 text-sm font-semibold">Allowed business modules</legend>
    <p className="text-sm text-muted-foreground">Selected modules start enabled. The tenant admin can disable them later.</p>
    {moduleKeys.map(key => {
      const selected = value.includes(key)
      const problem = moduleAllowanceProblem(flags, key, !selected)
      return <div key={key} className="space-y-1"><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={selected} disabled={disabled || !!problem} onChange={event => onChange(event.target.checked ? [...value, key] : value.filter(item => item !== key))}/>{businessModules[key].name}</label>{problem && <p className="pl-6 text-xs text-muted-foreground">{problem}</p>}</div>
    })}
  </fieldset>
}
