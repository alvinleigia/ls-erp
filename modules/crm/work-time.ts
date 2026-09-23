// Date-only work stays a calendar date; timed work is an absolute instant.
export function wallTime(instant: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant))
  const get = (type: string) => parts.find(part => part.type === type)?.value
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}
export function wallTimeToInstant(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid date and time.")
  const naive = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) throw new Error("Choose a valid date and time.")
  const offsets = new Set<number>()
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = new Date(naive + delta)
    offsets.add(Date.parse(`${wallTime(sample, timeZone)}:00Z`) - sample.getTime())
  }
  const candidates = [...offsets].map(offset => new Date(naive - offset)).filter(date => wallTime(date, timeZone) === value)
  if (candidates.length !== 1) throw new Error(candidates.length ? "This time occurs twice during a daylight-saving change. Choose an unambiguous time." : "This local time does not exist during a daylight-saving change.")
  return candidates[0].toISOString()
}
export const businessDate = (instant: Date, timeZone: string) => wallTime(instant, timeZone).slice(0, 10)

// First instant of a local date, including zones whose DST transition skips midnight.
// A skipped calendar date has an empty interval ending at the next date's start.
export function startOfBusinessDate(date: string, timeZone: string) {
  const nominal = Date.parse(`${date}T00:00:00Z`)
  let low = nominal - 36 * 3600000, high = nominal + 36 * 3600000
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (businessDate(new Date(middle), timeZone) < date) low = middle + 1
    else high = middle
  }
  return new Date(low)
}
