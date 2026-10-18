"use client"
import * as React from "react"
import { createTermResolver, defaultTermResolver, type TermResolver } from "./resolver"
import type { TerminologySnapshot } from "./service"

const Context = React.createContext<TermResolver>(defaultTermResolver)

// Mounted inside the tenant/user-keyed protected layout. No cross-tenant cache.
export function TerminologyProvider({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const [snapshot, setSnapshot] = React.useState<TerminologySnapshot | null>(null)
  React.useEffect(() => {
    if (!active) return
    let controller: AbortController
    const load = (event?: Event) => {
      controller?.abort(); controller = new AbortController()
      const { signal } = controller
      if (event?.type !== "focus") setSnapshot(null)
      fetch("/api/settings/terminology", { cache: "no-store", signal })
        .then(async response => response.ok ? response.json() : null)
        .then(data => { if (!signal.aborted) setSnapshot(data) })
        .catch(() => { if (!signal.aborted) setSnapshot(null) })
    }
    load()
    for (const event of ["terminology-changed", "business-modules-changed", "focus"]) window.addEventListener(event, load)
    return () => {
      controller.abort()
      for (const event of ["terminology-changed", "business-modules-changed", "focus"]) window.removeEventListener(event, load)
    }
  }, [active])
  const term = React.useMemo(() => active && snapshot ? createTermResolver(snapshot.replacements) : defaultTermResolver, [active, snapshot])
  return <Context.Provider value={term}>{children}</Context.Provider>
}

export const useTerminology = () => React.useContext(Context)

// For async failures: read the latest labels without making a record-loading
// effect depend on label changes (which would reset unsaved form state).
export function useTerminologyReader() {
  const term = useTerminology(), current = React.useRef(term)
  React.useLayoutEffect(() => { current.current = term }, [term])
  return React.useCallback<TermResolver>((...args) => current.current(...args), [])
}
