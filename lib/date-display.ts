import { DEFAULT_DATE_FORMAT, formatDateForDisplay } from "./date"
import { wallTime } from "./business-time"

export type DateDisplaySettings = { timeZone: string; locale: string; dateFormat: string; timeFormat: "H12" | "H24" }
export const defaultDateDisplaySettings: DateDisplaySettings = { timeZone: "UTC", locale: "en-US", dateFormat: DEFAULT_DATE_FORMAT, timeFormat: "H24" }

// DATE values may arrive serialized as midnight UTC. Keep their calendar day.
export function formatDateOnly(value: string | Date | null | undefined, dateFormat: string) {
  if (!value) return "-"
  const raw = value instanceof Date ? Number.isNaN(value.getTime()) ? "" : value.toISOString() : value
  return formatDateForDisplay(raw.slice(0, 10), dateFormat)
}

export function formatInstantTime(instant: string | Date, settings: DateDisplaySettings) {
  return new Intl.DateTimeFormat(settings.locale, {
    timeZone: settings.timeZone, hour: "2-digit", minute: "2-digit",
    hourCycle: settings.timeFormat === "H12" ? "h12" : "h23",
  }).format(new Date(instant))
}

export function formatInstant(instant: string | Date, settings: DateDisplaySettings) {
  const localDate = wallTime(instant, settings.timeZone).slice(0, 10)
  return `${formatDateForDisplay(localDate, settings.dateFormat)} ${formatInstantTime(instant, settings)} (${settings.timeZone})`
}
