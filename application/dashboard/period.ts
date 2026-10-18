const firstDayIndexMap = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const

export const addDays = (value: Date, days: number) => {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

const parseDateOnly = (value: string | null) => {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export const dateKeyToUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`)
export const addDaysToDateKey = (value: string, days: number) => {
  const base = dateKeyToUtcDate(value)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

const getDatePartsInTimeZone = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = formatter.formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00"
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  }
}

export const toDateKeyInTimeZone = (value: Date, timeZone: string) => {
  const parts = getDatePartsInTimeZone(value, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export const toDateLabelInTimeZone = (value: Date, timeZone: string) =>
  value.toLocaleDateString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  })

const getTimePartsInTimeZone = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0")
  return {
    hour: get("hour"),
    minute: get("minute"),
  }
}

export const zonedDateTimeToUtc = (
  dateKey: string,
  timeZone: string,
  hour = 0,
  minute = 0
) => {
  let probe = new Date(
    `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`
  )

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dateParts = getDatePartsInTimeZone(probe, timeZone)
    const timeParts = getTimePartsInTimeZone(probe, timeZone)

    const current = Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
      timeParts.hour,
      timeParts.minute
    )
    const target = Date.UTC(
      Number(dateKey.slice(0, 4)),
      Number(dateKey.slice(5, 7)) - 1,
      Number(dateKey.slice(8, 10)),
      hour,
      minute
    )
    const deltaMinutes = Math.round((target - current) / 60000)
    if (deltaMinutes === 0) break
    probe = new Date(probe.getTime() + deltaMinutes * 60000)
  }

  return probe
}

export const getRangeBounds = (
  range: string,
  firstDayOfWeek: keyof typeof firstDayIndexMap,
  startDateRaw: string | null,
  endDateRaw: string | null,
  timeZone: string
) => {
  const now = new Date()
  // Bounds are calendar dates; only turn them into instants after choosing the
  // tenant's dates. Host-local midnight can otherwise shift reports by one day.
  const today = dateKeyToUtcDate(toDateKeyInTimeZone(now, timeZone))

  if (range === "today") {
    const endExclusive = addDays(today, 1)
    return { label: "Today", start: today, endExclusive }
  }

  if (range === "month") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const endExclusive = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
    return { label: "This month", start, endExclusive }
  }

  if (range === "custom") {
    const parsedStart = parseDateOnly(startDateRaw)
    const parsedEnd = parseDateOnly(endDateRaw)
    if (parsedStart && parsedEnd && parsedStart <= parsedEnd) {
      return {
        label: "Custom range",
        start: parsedStart,
        endExclusive: addDays(parsedEnd, 1),
      }
    }
  }

  const firstIndex = firstDayIndexMap[firstDayOfWeek] ?? 0
  const currentIndex = today.getUTCDay()
  const diff = (currentIndex - firstIndex + 7) % 7
  const start = addDays(today, -diff)
  return {
    label: "This week",
    start,
    endExclusive: addDays(start, 7),
  }
}
