import { formatDateForDisplay } from "@/lib/date"
import { defaultDateDisplaySettings, formatInstant, type DateDisplaySettings } from "@/lib/date-display"

export type WorkHistoryFormat = DateDisplaySettings
export const defaultWorkHistoryFormat = defaultDateDisplaySettings

export function formatWorkHistoryTime(instant: string, settings: WorkHistoryFormat) {
  return formatInstant(instant, settings)
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
