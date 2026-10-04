import type { AuditFieldChange } from "@/types/reports"

const sensitive = /password|passwd|secret|token|authorization|cookie|apikey|licensekey|privatekey|connectionstring|databaseurl|directurl|smtp|credential/i
const hidden = "[redacted]"
const bookkeeping = new Set(["id", "tenantId", "version", "createdAt", "updatedAt", "nameKey"])
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** Defense in depth for historical snapshots; stored audit rows are never rewritten. */
export function redactAudit(value: unknown, depth = 0): unknown {
 if (depth > 16) return "[nested value omitted]"
 if (Array.isArray(value)) return value.map(item => redactAudit(item, depth + 1))
 if (!object(value)) return value ?? null
 return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key.replace(/[^a-z0-9]/gi, "")) ? hidden : redactAudit(item, depth + 1)]))
}

export function auditChanges(before: unknown, after: unknown): AuditFieldChange[] {
 const changes: AuditFieldChange[] = []
 function compare(left: unknown, right: unknown, prefix: string) {
  if (object(right)) {
   // Update events may store only a patch. Omitted fields are not removals.
   for (const [key, value] of Object.entries(right)) {
    if (!prefix && bookkeeping.has(key)) continue
    compare(object(left) ? left[key] : undefined, value, prefix ? `${prefix}.${key}` : key)
   }
  } else if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) changes.push({ field: prefix || "Value", before: left ?? null, after: right ?? null })
 }
 if (after === null || after === undefined) {
  if (object(before)) for (const [key, value] of Object.entries(before)) { if (!bookkeeping.has(key)) changes.push({ field: key, before: value, after: null }) }
 } else compare(before, after, "")
 return changes
}
