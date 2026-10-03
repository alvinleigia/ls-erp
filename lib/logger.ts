import { APPLICATION_ID } from "@/lib/branding"
type LogLevel = "debug" | "info" | "warn" | "error"

type LogContext = Record<string, unknown>

const REDACTED = "[REDACTED]"
const MAX_DEPTH = 5
const SENSITIVE_KEY_MATCHERS = [
  /password/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /api[-_]?key/i,
]

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const shouldRedactKey = (key: string) =>
  SENSITIVE_KEY_MATCHERS.some((matcher) => matcher.test(key))

const sanitizeError = (error: Error) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
})

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return "[MAX_DEPTH_REACHED]"
  if (value instanceof Error) return sanitizeError(value)
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1))
  }
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      next[key] = shouldRedactKey(key) ? REDACTED : sanitizeValue(nested, depth + 1)
    }
    return next
  }
  return value
}

const writeLog = (level: LogLevel, event: string, context?: LogContext) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: APPLICATION_ID,
    env: process.env.NODE_ENV ?? "development",
    ...(context ? (sanitizeValue(context) as LogContext) : {}),
  }
  const line = JSON.stringify(payload)
  if (level === "error") {
    console.error(line)
    return
  }
  if (level === "warn") {
    console.warn(line)
    return
  }
  console.log(line)
}

export const logger = {
  debug: (event: string, context?: LogContext) => writeLog("debug", event, context),
  info: (event: string, context?: LogContext) => writeLog("info", event, context),
  warn: (event: string, context?: LogContext) => writeLog("warn", event, context),
  error: (event: string, context?: LogContext) => writeLog("error", event, context),
}

