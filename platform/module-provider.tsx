"use client"
import type { Permission, Requirement } from "./access/catalog"
import { satisfies } from "./access/policy"
import * as React from "react"
import { moduleEnabled, type ModuleFlag, type BusinessModuleKey } from "./modules"

const Context = React.createContext<{ flags: ModuleFlag[]; loading: boolean; permissions?: Permission[] }>({ flags: [], loading: true, permissions: [] })
export function BusinessModuleProvider({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const [state, setState] = React.useState<{ flags: ModuleFlag[]; loading: boolean; permissions?: Permission[] }>({ flags: [], loading: active, permissions: [] })
  React.useEffect(() => {
    if (!active) return
    let controller: AbortController
    const load = (event?: Event) => {
      controller?.abort(); controller = new AbortController()
      const signal = controller.signal
      if (event?.type !== "focus") setState({ flags: [], loading: true, permissions: [] })
      fetch("/api/modules", { cache: "no-store", signal }).then(async response => response.ok ? response.json() : null)
        .then(data => { if (!signal.aborted) setState({ flags: data?.modules || [], loading: false, permissions: data?.permissions === null ? undefined : data?.permissions || [] }) })
        .catch(() => { if (!signal.aborted) setState({ flags: [], loading: false, permissions: [] }) })
    }
    load(); window.addEventListener("business-modules-changed", load); window.addEventListener("focus", load)
    return () => { controller.abort(); window.removeEventListener("business-modules-changed", load); window.removeEventListener("focus", load) }
  }, [active])
  return <Context.Provider value={state}>{children}</Context.Provider>
}
export function useBusinessModules() {
  const state = React.useContext(Context)
  return { ...state, can: (requirement: Requirement) => !state.loading && satisfies(state, requirement), enabled: (key: BusinessModuleKey) => moduleEnabled(state.flags, key) }
}
