"use client"
import type { Permission, Requirement } from "./access/catalog"
import { satisfies } from "./access/policy"
import { allPermissions } from "./access/catalog"
import { RecordAccessContext } from "./access/record-context"
import * as React from "react"
import { moduleEnabled, type ModuleFlag, type BusinessModuleKey } from "./modules"

const Context = React.createContext<{ flags: ModuleFlag[]; loading: boolean; canManage: boolean; permissions?: Permission[] }>({ flags: [], loading: true, canManage: false, permissions: [] })
export function BusinessModuleProvider({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const [state, setState] = React.useState<{ flags: ModuleFlag[]; loading: boolean; canManage: boolean; permissions?: Permission[] }>({ flags: [], loading: active, canManage: false, permissions: [] })
  React.useEffect(() => {
    if (!active) return
    let controller: AbortController
    const load = (event?: Event) => {
      controller?.abort(); controller = new AbortController()
      const signal = controller.signal
      // Refresh in place so an unrelated module change does not discard forms.
      // The response replaces permissions atomically; failures still deny access.
      if (!event) setState({ flags: [], loading: true, canManage: false, permissions: [] })
      fetch("/api/modules", { cache: "no-store", signal }).then(async response => response.ok ? response.json() : null)
        .then(data => { if (!signal.aborted) setState({ flags: data?.modules || [], loading: false, canManage: Boolean(data?.canManage), permissions: data?.permissions === null ? undefined : data?.permissions || [] }) })
        .catch(() => { if (!signal.aborted) setState({ flags: [], loading: false, canManage: false, permissions: [] }) })
    }
    load(); window.addEventListener("business-modules-changed", load); window.addEventListener("focus", load)
    return () => { controller.abort(); window.removeEventListener("business-modules-changed", load); window.removeEventListener("focus", load) }
  }, [active])
  return <Context.Provider value={state}>{children}</Context.Provider>
}
export function useBusinessModules() {
  const state = React.useContext(Context)
  const record = React.useContext(RecordAccessContext)
  const permissions = React.useMemo(() => record ? allPermissions.filter(permission => satisfies(state, permission) && record.permissions[permission] !== false) : state.permissions, [record, state])
  return { ...state, permissions, can: (requirement: Requirement) => !state.loading && satisfies({ permissions }, requirement), enabled: (key: BusinessModuleKey) => moduleEnabled(state.flags, key) }
}
