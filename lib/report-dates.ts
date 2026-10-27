import { businessDate, wallTime } from "./business-time"
import { formatDateForDisplay } from "./date"
import { formatTimeFrom24h } from "./formatting"
import type { ReportDateContext } from "@/types/reports"

export function formatReportDateTime(value: string | null, context: ReportDateContext | null) {
  if (!value || !context) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return `${formatDateForDisplay(businessDate(date, context.timeZone), context.dateFormat)} ${formatTimeFrom24h(wallTime(date, context.timeZone).slice(11, 16), context)}`
}
