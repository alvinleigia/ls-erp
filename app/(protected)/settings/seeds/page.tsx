"use client"

import { useCreationOfficeSnapshot } from "@/platform/companies/creation-snapshot"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const seedGroups = [
  { key: "taxes", label: "Taxes (GST 18%, VAT 5%)" },
  { key: "users", label: "Users (5 customers, 5 staff, 2 managers)" },
  { key: "serviceCatalog", label: "Service categories + 10 services (includes package type, GST 18%)" },
  { key: "inventoryCatalog", label: "Inventory categories + suppliers + products (VAT 5%)" },
  { key: "purchases", label: "Purchases" },
  { key: "leaves", label: "Leave definitions + leave groups" },
  { key: "shifts", label: "Shift templates + schedules + assignments" },
  { key: "appointments", label: "Future + past appointments" },
  { key: "coupons", label: "Coupons" },
] as const

type SeedGroupKey = (typeof seedGroups)[number]["key"]
type ClearMode = "strict" | "include_dependents"

const moduleGroups = [
  { key: "appointments", label: "Appointments" },
  { key: "coupons", label: "Coupons" },
  { key: "purchases", label: "Purchases" },
  { key: "inventory", label: "Inventory" },
  { key: "shifts", label: "Shifts" },
  { key: "services", label: "Services" },
  { key: "taxes", label: "Taxes" },
  { key: "users", label: "Users (non-admin only)" },
] as const

type ModuleGroupKey = (typeof moduleGroups)[number]["key"]

export default function SeedsPage() {
  const creationHeaders = useCreationOfficeSnapshot()
  const [selected, setSelected] = React.useState<Record<SeedGroupKey, boolean>>({
    taxes: true,
    users: true,
    serviceCatalog: true,
    inventoryCatalog: true,
    purchases: true,
    leaves: true,
    shifts: true,
    appointments: true,
    coupons: true,
  })
  const [seeding, setSeeding] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [previewing, setPreviewing] = React.useState(false)
  const [modulePreviewing, setModulePreviewing] = React.useState(false)
  const [moduleClearing, setModuleClearing] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState("")
  const [moduleConfirmText, setModuleConfirmText] = React.useState("")
  const [clearMode, setClearMode] = React.useState<ClearMode>("include_dependents")
  const [selectedModules, setSelectedModules] = React.useState<Record<ModuleGroupKey, boolean>>({
    appointments: false,
    coupons: false,
    purchases: false,
    inventory: false,
    shifts: false,
    services: false,
    taxes: false,
    users: false,
  })
  const [result, setResult] = React.useState<string>("")

  const selectedGroups = React.useMemo(
    () =>
      seedGroups
        .filter((group) => selected[group.key])
        .map((group) => group.key),
    [selected]
  )

  const selectAll = () => {
    setSelected({
      taxes: true,
      users: true,
      serviceCatalog: true,
      inventoryCatalog: true,
      purchases: true,
      leaves: true,
      shifts: true,
      appointments: true,
      coupons: true,
    })
  }

  const clearSelection = () => {
    setSelected({
      taxes: false,
      users: false,
      serviceCatalog: false,
      inventoryCatalog: false,
      purchases: false,
      leaves: false,
      shifts: false,
      appointments: false,
      coupons: false,
    })
  }

  const selectedModuleKeys = React.useMemo(
    () => moduleGroups.filter((group) => selectedModules[group.key]).map((group) => group.key),
    [selectedModules]
  )

  const runSeed = async () => {
    if (!selectedGroups.length) {
      toast.error("Select at least one seed group.")
      return
    }
    setSeeding(true)
    setResult("")
    try {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 180000)
      const response = await fetch("/api/seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...await creationHeaders() },
        signal: controller.signal,
        body: JSON.stringify({
          action: "seed",
          groups: selectedGroups,
        }),
      })
      window.clearTimeout(timeoutId)

      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
        summary?: Record<string, number>
        executedGroups?: string[]
      }
      if (!response.ok) {
        toast.error(data.error ?? "Unable to apply seeds.")
        return
      }
      const summaryText = Object.entries(data.summary ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ")
      const executedText = (data.executedGroups ?? []).join(", ")
      setResult(
        [summaryText || "Seed completed.", executedText ? `Executed: ${executedText}` : ""]
          .filter(Boolean)
          .join(" | ")
      )
      toast.success(data.message ?? "Seed completed.")
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Seeding timed out. Reduce selected groups and retry."
          : "Unable to apply seeds."
      toast.error(message)
    } finally {
      setSeeding(false)
    }
  }

  const previewClear = async () => {
    setPreviewing(true)
    setResult("")
    const response = await fetch("/api/seeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "previewClear" }),
    })
    setPreviewing(false)
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      preview?: { wouldDelete?: Record<string, number>; preservedAdmins?: string[] }
    }
    if (!response.ok) {
      toast.error(data.error ?? "Unable to preview clear.")
      return
    }
    const deleteText = Object.entries(data.preview?.wouldDelete ?? {})
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
    const admins = data.preview?.preservedAdmins?.length ? data.preview.preservedAdmins.join(", ") : "(none)"
    setResult(`Preview delete -> ${deleteText || "nothing"} | Preserved admins -> ${admins}`)
    toast.success("Clear preview generated.")
  }

  const runClear = async () => {
    if (confirmText.trim().toUpperCase() !== "CLEAR") {
      toast.error("Type CLEAR to confirm data wipe.")
      return
    }
    setClearing(true)
    setResult("")
    const response = await fetch("/api/seeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    })
    setClearing(false)
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      message?: string
      result?: { preservedAdmins?: string[]; deleted?: Record<string, number> }
    }
    if (!response.ok) {
      toast.error(data.error ?? "Unable to clear data.")
      return
    }
    const deletedSummary = Object.entries(data.result?.deleted ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
    const admins = data.result?.preservedAdmins?.join(", ") || "Admin users"
    setResult(`Deleted -> ${deletedSummary}. Preserved -> ${admins}.`)
    setConfirmText("")
    toast.success(data.message ?? "Data cleared.")
  }

  const previewModuleClear = async () => {
    if (!selectedModuleKeys.length) {
      toast.error("Select at least one module.")
      return
    }
    setModulePreviewing(true)
    setResult("")
    const response = await fetch("/api/seeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "previewModulesClear",
        modules: selectedModuleKeys,
        mode: clearMode,
      }),
    })
    setModulePreviewing(false)
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: Record<string, string[]>
      expandedModules?: string[]
      autoIncludedModules?: string[]
      preview?: { wouldDelete?: Record<string, number>; preservedAdmins?: string[] }
    }
    if (!response.ok) {
      const detailsText = data.details ? JSON.stringify(data.details) : ""
      toast.error(data.error ? `${data.error}${detailsText ? ` ${detailsText}` : ""}` : "Unable to preview module clear.")
      return
    }
    const deleteText = Object.entries(data.preview?.wouldDelete ?? {})
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
    const autoText = (data.autoIncludedModules ?? []).join(", ")
    setResult(
      `Module preview -> ${deleteText || "nothing"} | Expanded modules: ${(data.expandedModules ?? []).join(", ")}${
        autoText ? ` | Auto included: ${autoText}` : ""
      }`
    )
    toast.success("Module clear preview generated.")
  }

  const runModuleClear = async () => {
    if (!selectedModuleKeys.length) {
      toast.error("Select at least one module.")
      return
    }
    if (moduleConfirmText.trim().toUpperCase() !== "MODULE CLEAR") {
      toast.error('Type "MODULE CLEAR" to confirm module deletion.')
      return
    }
    setModuleClearing(true)
    setResult("")
    const response = await fetch("/api/seeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "clearModules",
        modules: selectedModuleKeys,
        mode: clearMode,
      }),
    })
    setModuleClearing(false)
    const data = (await response.json().catch(() => ({}))) as {
      error?: string
      details?: Record<string, string[]>
      expandedModules?: string[]
      autoIncludedModules?: string[]
      result?: { deleted?: Record<string, number>; preservedAdmins?: string[] }
      message?: string
    }
    if (!response.ok) {
      const detailsText = data.details ? JSON.stringify(data.details) : ""
      toast.error(data.error ? `${data.error}${detailsText ? ` ${detailsText}` : ""}` : "Unable to clear selected modules.")
      return
    }
    const deletedText = Object.entries(data.result?.deleted ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ")
    const autoText = (data.autoIncludedModules ?? []).join(", ")
    setResult(
      `Module clear deleted -> ${deletedText || "nothing"} | Expanded modules: ${(data.expandedModules ?? []).join(", ")}${
        autoText ? ` | Auto included: ${autoText}` : ""
      }`
    )
    setModuleConfirmText("")
    toast.success(data.message ?? "Module clear completed.")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Seeds</h1>
        <p className="text-sm text-muted-foreground">
          Seed demo data and clear business data while preserving global settings and admin users.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Seeded non-admin users use password: <span className="font-mono">password123</span>. Admin users are not created
          or updated by seed actions.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Seed Groups</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select all
            </Button>
            <Button variant="outline" size="sm" onClick={clearSelection}>
              Clear selection
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          {seedGroups.map((group) => (
            <label key={group.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected[group.key]}
                onChange={(event) =>
                  setSelected((prev) => ({ ...prev, [group.key]: event.target.checked }))
                }
              />
              <span>{group.label}</span>
            </label>
          ))}
        </div>

        <Button onClick={() => void runSeed()} loading={seeding} loadingText="Seeding...">
          Seed selected
        </Button>
      </div>

      <div className="rounded-xl border border-destructive/40 bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
        <p className="text-xs text-muted-foreground">
          This deletes business data (appointments, inventory, users except admins, services, shifts, taxes, coupons).
          Global settings and admin users are preserved.
        </p>
        <Button variant="outline" onClick={() => void previewClear()} loading={previewing} loadingText="Previewing...">
          Preview clear impact
        </Button>
        <Input
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder='Type "CLEAR" to confirm'
        />
        <Button
          variant="destructive"
          onClick={() => void runClear()}
          loading={clearing}
          loadingText="Clearing..."
        >
          Clear data (keep admins + global settings)
        </Button>
      </div>

      <div className="rounded-xl border border-destructive/40 bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-destructive">Module Clear</h2>
        <p className="text-xs text-muted-foreground">
          Delete specific modules only. In include-dependents mode, required related modules are auto-added and deleted in safe sequence.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {moduleGroups.map((group) => (
            <label key={group.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedModules[group.key]}
                onChange={(event) =>
                  setSelectedModules((prev) => ({ ...prev, [group.key]: event.target.checked }))
                }
              />
              <span>{group.label}</span>
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Clear mode
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
            value={clearMode}
            onChange={(event) => setClearMode(event.target.value as ClearMode)}
          >
            <option value="include_dependents">Include dependents (recommended)</option>
            <option value="strict">Strict (error on missing dependencies)</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void previewModuleClear()}
            loading={modulePreviewing}
            loadingText="Previewing..."
          >
            Preview module clear
          </Button>
        </div>
        <Input
          value={moduleConfirmText}
          onChange={(event) => setModuleConfirmText(event.target.value)}
          placeholder='Type "MODULE CLEAR" to confirm'
        />
        <Button
          variant="destructive"
          onClick={() => void runModuleClear()}
          loading={moduleClearing}
          loadingText="Clearing..."
        >
          Clear selected modules
        </Button>
      </div>

      {result ? (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          {result}
        </div>
      ) : null}
    </div>
  )
}
