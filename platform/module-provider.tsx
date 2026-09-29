"use client"
import * as React from "react"
import { moduleEnabled, type ModuleFlag, type BusinessModuleKey } from "./modules"

const Context = React.createContext<{ flags: ModuleFlag[]; loading: boolean }>({ flags: [], loading: true })
export function BusinessModuleProvider({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const [state, setState] = React.useState({ flags: [] as ModuleFlag[], loading: active })
  React.useEffect(() => {
    if (!active) return
    let controller: AbortController
    const load = () => {
      controller?.abort(); controller = new AbortController()
      const signal = controller.signal
      setState({ flags: [], loading: true })
      fetch("/api/modules", { cache: "no-store", signal }).then(async response => response.ok ? response.json() : null)
        .then(data => { if (!signal.aborted) setState({ flags: data?.modules || [], loading: false }) })
        .catch(() => { if (!signal.aborted) setState({ flags: [], loading: false }) })
    }
    load(); window.addEventListener("business-modules-changed", load)
    return () => { controller.abort(); window.removeEventListener("business-modules-changed", load) }
  }, [active])
  return <Context.Provider value={state}>{children}</Context.Provider>
}
export function useBusinessModules() {
  const state = React.useContext(Context)
  return { ...state, enabled: (key: BusinessModuleKey) => moduleEnabled(state.flags, key) }
}
