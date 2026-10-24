// Optional editor lookups must not turn a readable record into an inaccessible
// page. This never substitutes for authorization of the primary record or write.
export async function optionalReference<T>(url: string, allowed: boolean, signal?: AbortSignal): Promise<T | null> {
  if (!allowed) return null
  const response = await fetch(url, { signal, cache: "no-store" })
  if (response.status === 403) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Unable to load reference options.")
  return data
}

export type AssignmentContext = { currentUserId: string; canAssign: boolean }
