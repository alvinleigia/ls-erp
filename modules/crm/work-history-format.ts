import { DEFAULT_DATE_FORMAT, formatDateForDisplay } from "@/lib/date"
import { wallTime } from "./work-time"

export type WorkHistoryFormat = { timeZone: string; locale: string; dateFormat: string; timeFormat: "H12" | "H24" }
export const defaultWorkHistoryFormat: WorkHistoryFormat = { timeZone: "UTC", locale: "en-US", dateFormat: DEFAULT_DATE_FORMAT, timeFormat: "H24" }

export function formatWorkHistoryTime(instant: string, settings: WorkHistoryFormat) {
  const localDate = wallTime(instant, settings.timeZone).slice(0, 10)
  const time = new Intl.DateTimeFormat(settings.locale, {
    timeZone: settings.timeZone, hour: "2-digit", minute: "2-digit",
    hourCycle: settings.timeFormat === "H12" ? "h12" : "h23",
  }).format(new Date(instant))
  return `${formatDateForDisplay(localDate, settings.dateFormat)} ${time} (${settings.timeZone})`
}

// Localize the application's stored reschedule sentence at display time, so old
// entries benefit too. Never rewrite audit records or staff-authored notes.
export function formatWorkHistoryMessage(item: { event: string; message: string }, settings: WorkHistoryFormat) {
  if (item.event !== "crm.work.updated") return item.message
  return item.message.replace(/ Rescheduled to (\d{4}-\d{2}-\d{2})(?: \((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\))?\.$/, (original, date: string, instant?: string) => {
    if (instant && !Number.isFinite(Date.parse(instant))) return original
    return ` Rescheduled to ${instant ? formatWorkHistoryTime(instant, settings) : `${formatDateForDisplay(date, settings.dateFormat)} (all day)`}.`
  })
}
