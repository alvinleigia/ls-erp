/** Presentation state only. Never store records, credentials, drafts or access decisions. */
export type ListStateKind = "value" | "sorting" | "visibility" | "date-range" | "period" | "nullable-string"
export type ListStateOptions = { kind?: ListStateKind; validate?: (value: unknown) => boolean; resetPages?: boolean; resetScopes?: readonly string[] }
export const listQueryPrefix = "l."
const limit = 4096
const forbidden = new Set(["__proto__", "prototype", "constructor"])

function pack(value: unknown): unknown {
  if (value instanceof Date) return { $listDate: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` }
  if (Array.isArray(value)) return value.map(pack)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, pack(entry)]))
  return value
}
function unpack(value: unknown, depth = 0): unknown {
  if (depth > 5) throw Error("List state is too deep")
  if (Array.isArray(value)) { if (value.length > 100) throw Error("List state is too large"); return value.map(entry => unpack(entry, depth + 1)) }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
    if (entries.length > 80 || entries.some(([key]) => forbidden.has(key))) throw Error("Invalid list state keys")
    if (entries.length === 1 && entries[0][0] === "$listDate") {
      const text = String(entries[0][1])
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Error("Invalid list date")
      const [year, month, day] = text.split("-").map(Number), date = new Date(year, month - 1, day)
      if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw Error("Invalid list date")
      return date
    }
    return Object.fromEntries(entries.map(([key, entry]) => [key, unpack(entry, depth + 1)]))
  }
  if (typeof value === "string" && value.length > 2000) throw Error("List text is too long")
  if (typeof value === "number" && !Number.isFinite(value)) throw Error("Invalid list number")
  return value
}
export function listValueText(value: unknown) { return JSON.stringify(pack(value)) ?? "null" }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
function matches(value: unknown, sample: unknown, key: string): boolean {
  if (sample instanceof Date) return value instanceof Date && Number.isFinite(value.getTime())
  if (sample === null || sample === undefined) return value === null || value === undefined
  if (typeof sample === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false
    if (/^(page|pageIndex|rosterPage|staffPage|gapPage|applicationPage|historyPage|optionPage)$/i.test(key)) return Number.isInteger(value) && value >= (key === "pageIndex" ? 0 : 1) && value <= 1_000_000
    if (/^(pageSize|size)$/i.test(key)) return Number.isInteger(value) && value >= 1 && value <= 100
    return Math.abs(value) <= 1_000_000_000
  }
  if (typeof sample !== typeof value) return false
  if (typeof sample === "string" || typeof sample === "boolean") return true
  if (Array.isArray(sample)) return Array.isArray(value) && value.length <= 100 && value.every(entry => sample.length ? matches(entry, sample[0], key) : typeof entry === "string")
  if (object(sample)) return object(value) && Object.keys(value).every(k => Object.hasOwn(sample, k)) && Object.entries(sample).every(([k, entry]) => matches(value[k], entry, k))
  return false
}
function valid(value: unknown, sample: unknown, key: string, options: ListStateOptions) {
  if (options.validate) return options.validate(value)
  if (options.kind === "sorting") return Array.isArray(value) && value.length <= 8 && value.every(row => object(row) && Object.keys(row).every(k => k === "id" || k === "desc") && typeof row.id === "string" && row.id.length <= 80 && typeof row.desc === "boolean")
  if (options.kind === "visibility") return object(value) && Object.entries(value).every(([k, v]) => k.length <= 80 && typeof v === "boolean")
  if (options.kind === "nullable-string") return value == null || typeof value === "string"
  if (options.kind === "date-range") return value == null || object(value) && Object.keys(value).every(k => k === "from" || k === "to") && [value.from, value.to].every(v => v == null || v instanceof Date)
  if (options.kind === "period") return value == null || object(value) && Object.keys(value).every(k => ["from", "to", "through", "completedFrom", "completedThrough"].includes(k)) && Object.values(value).every(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
  return matches(value, sample, key)
}
export function listStateKey(scope: string, field: string) { return `${listQueryPrefix}${scope}.${field}` }
export function readListValue<T>(raw: string | null, sample: T, field: string, options: ListStateOptions = {}): T {
  if (raw === null || raw.length > limit) return sample
  try {
    const value = unpack(JSON.parse(raw))
    return valid(value, sample, field, options) ? value as T : sample
  } catch { return sample }
}
export function writeListValue(params: URLSearchParams, key: string, value: unknown, sample: unknown) {
  const text = listValueText(value)
  if (text.length > limit) return false
  if (text === listValueText(sample)) params.delete(key)
  else params.set(key, text)
  return true
}
export function resetListPages(params: URLSearchParams, scopes: readonly string[], changed: string) {
  for (const [key, raw] of params) {
    if (key === changed || !scopes.some(scope => key.startsWith(`${listQueryPrefix}${scope}.`))) continue
    const field = key.slice(key.lastIndexOf(".") + 1)
    try {
      const value: unknown = JSON.parse(raw)
      if (/^(?:page(?:-.*)?|\w+Page)$/.test(field) && typeof value === "number" && value !== 1) params.set(key, "1")
      else if (["pagination", "query", "q"].includes(field) && object(value)) {
        if (Number.isInteger(value.pageIndex)) params.set(key, JSON.stringify({ ...value, pageIndex: 0 }))
        else if (Number.isInteger(value.page)) params.set(key, JSON.stringify({ ...value, page: 1 }))
      }
    } catch { /* Invalid URL values are ignored by the individual control codec. */ }
  }
}

const contextKeys = new Set([
  "view", "tab", "parentId", "projectId", "subprojectId", "enquiryId", "opportunityId", "contactId", "revision", "template", "all", "batch",
  // Existing dashboard/report links initialize the activity list through these
  // route parameters, before any namespaced control has been changed.
  "responsibleType", "introduction", "introducedByCollaboratorId", "introductionSupervisorId", "planLaunchId", "scope", "due", "state", "type", "activityTypeId", "assignedUserId", "salesTeamId", "completedFrom", "completedThrough",
])
export function internalListUrl(href: string): URL | null {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/.test(href)) return null
  try {
    const url = new URL(href, "https://list.invalid")
    const path = decodeURIComponent(url.pathname)
    if (url.origin !== "https://list.invalid" || path.startsWith("//") || /[\\\u0000-\u001f]|%2f|%5c/i.test(path) || /^\/(?:api|auth)(?:\/|$)/.test(path)) return null
    return url
  } catch { return null }
}
export function cleanListLocation(href: string): string | null {
  const url = internalListUrl(href)
  if (!url || href.length > 16_000) return null
  for (const key of Array.from(url.searchParams.keys())) if (!key.startsWith(listQueryPrefix) && !contextKeys.has(key)) url.searchParams.delete(key)
  return url.pathname + url.search + (/^#[\w-]{1,80}$/.test(url.hash) ? url.hash : "")
}
export function rememberedListHref(fallback: string, saved: string | undefined): string {
  const target = internalListUrl(fallback), previous = saved && internalListUrl(saved)
  if (!target || !previous || target.pathname !== previous.pathname) return fallback
  if (target.hash && target.hash !== previous.hash) return fallback
  for (const [key, value] of target.searchParams) if (previous.searchParams.get(key) !== value) return fallback
  return cleanListLocation(saved!) || fallback
}
export type ListLocations = { path: string; href: string }[]
export function readListLocations(raw: string | null): ListLocations {
  try {
    const parsed: unknown = JSON.parse(raw || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.slice(-64).flatMap(entry => {
      if (!object(entry) || typeof entry.href !== "string") return []
      const href = cleanListLocation(entry.href), url = href && internalListUrl(href)
      return href && url ? [{ path: url.pathname, href }] : []
    })
  } catch { return [] }
}
