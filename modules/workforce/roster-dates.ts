// Database DATE values represent calendar days, never local-server instants.
export const dateKey = (value: Date) => value.toISOString().slice(0, 10)
export function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : null
}
export function enumerateDates(start: Date, end: Date) {
  const dates: Date[] = []
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) dates.push(new Date(day))
  return dates
}
export function dateKeyInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value)
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-")
}
export const timeMinutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m }
function wallMinutes(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value)
  const part = (key: string) => Number(parts.find(p => p.type === key)!.value)
  return part("hour") * 60 + part("minute") + part("second") / 60 + value.getUTCMilliseconds() / 60000
}
// Clip an appointment to the affected business day, including overnight bookings.
export function appointmentRangeOnDate(start: Date, end: Date, day: string, timeZone: string) {
  const first = dateKeyInTimeZone(start, timeZone), last = dateKeyInTimeZone(end, timeZone)
  if (first > day || last < day) return null
  const from = first < day ? 0 : wallMinutes(start, timeZone)
  const to = last > day ? 1440 : wallMinutes(end, timeZone)
  // A clock rollback can make a real interval appear reversed in wall time.
  // Treat it conservatively rather than silently dropping that booking.
  if (first === day && last === day && end > start && to <= from) return { start: 0, end: 1440 }
  return to > from ? { start: from, end: to } : null
}
