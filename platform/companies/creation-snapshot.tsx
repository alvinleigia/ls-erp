"use client"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import type { WorkspaceOfficeContext } from "@/types/companies"

type Capture = { headers: Record<string, string>; context?: WorkspaceOfficeContext; error?: string }
// Capture when the form opens, not when Save is pressed. A preference change in
// another tab must produce a version conflict instead of rerouting a draft.
export function useCreationOfficeContext(enabled = true) {
  const captured = useRef<Promise<Capture> | null>(null)
  const [view, setView] = useState<{ revision: number; value: Capture } | null>(null)
  const [revision, reload] = useReducer(value => value + 1, 0)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    captured.current = fetch("/api/workspace/office", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load the creation office.")
      return { headers: data.creationOffice ? { "x-office-id": data.creationOffice.id, "x-office-version": String(data.version) } : {}, context: data } as Capture
    }).catch(error => ({ headers: {}, error: (error as Error).message }))
    void captured.current.then(value => { if (!controller.signal.aborted) setView({ revision, value }) })
    return () => controller.abort()
  }, [enabled, revision])
  const headers = useCallback(async (): Promise<Record<string, string>> => {
    if (!enabled) return {}
    if (!captured.current) throw new Error("The creation office is loading. Try again.")
    const result = await captured.current
    if (result.error) throw new Error(result.error)
    return result.headers
  }, [enabled])
  const current = view?.revision === revision ? view.value : undefined
  return { headers, context: enabled ? current?.context : undefined, error: enabled ? current?.error : undefined, loading: enabled && !current, reload }
}
export function useCreationOfficeSnapshot(enabled = true) {
  return useCreationOfficeContext(enabled).headers
}
