"use client"
import { useEffect, useRef } from "react"

type Capture = { headers: Record<string, string>; error?: string }
// Capture when the form opens, not when Save is pressed. A preference change in
// another tab must produce a version conflict instead of rerouting a draft.
export function useCreationOfficeSnapshot(enabled = true) {
  const captured = useRef<Promise<Capture> | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    captured.current = fetch("/api/workspace/office", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Unable to load the creation office.")
      return { headers: data.creationOffice ? { "x-office-id": data.creationOffice.id, "x-office-version": String(data.version) } : {} } as Capture
    }).catch(error => ({ headers: {}, error: (error as Error).message }))
    return () => controller.abort()
  }, [enabled])
  return async (): Promise<Record<string, string>> => {
    if (!enabled) return {}
    if (!captured.current) throw new Error("The creation office is loading. Try again.")
    const result = await captured.current
    if (result.error) throw new Error(result.error)
    return result.headers
  }
}
