// PostgreSQL omits key values when RLS would make them unsafe to disclose.
// In that case adapter-pg retains the constraint name only in originalMessage.
export function constraintTarget(error: unknown) {
  const meta = (error as { meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown }; originalMessage?: string } } } }).meta
  const cause = meta?.driverAdapterError?.cause
  const constraintName = cause?.originalMessage?.match(/unique constraint "([^"]+)"/)?.[1]
  return [meta?.target, cause?.constraint?.fields, constraintName].filter(Boolean).map(String).join(",")
}
export function serializationConflict(error: unknown) {
  const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
  return value.code === "P2034" || (value.code === "P2010" && (value.meta?.code === "40001" || value.meta?.driverAdapterError?.cause?.originalCode === "40001"))
}
