"use client"

import * as React from "react"
import { formatDateForDisplay } from "@/lib/date"
import { defaultDateDisplaySettings, formatDateOnly, formatInstant, formatInstantTime, type DateDisplaySettings } from "@/lib/date-display"

let cachedSettings: DateDisplaySettings | null = null
let pending: Promise<DateDisplaySettings | null> | null = null
const loadSettings = () => {
  if (cachedSettings) return Promise.resolve(cachedSettings)
  if (!pending) {
    pending = fetch("/api/settings/display", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) return null
        const data = await response.json() as { settings?: Partial<DateDisplaySettings> }
        if (!data.settings) return null
        cachedSettings = { ...defaultDateDisplaySettings, ...data.settings }
        return cachedSettings
      })
      .catch(() => null)
      .finally(() => { pending = null })
  }
  return pending
}

export const useDateFormatter = () => {
  const [settings, setSettings] = React.useState(cachedSettings)
  React.useEffect(() => {
    let active = true
    void loadSettings().then(value => { if (active && value) setSettings(value) })
    return () => { active = false }
  }, [])
  const display = settings ?? defaultDateDisplaySettings
  // Preserve the legacy date API for callers that deliberately use local Dates.
  const formatDate = React.useCallback((value?: string | Date | null) => formatDateForDisplay(value, display.dateFormat), [display.dateFormat])
  const dateOnly = React.useCallback((value?: string | Date | null) => formatDateOnly(value, display.dateFormat), [display.dateFormat])
  const dateTime = React.useCallback((value: string | Date) => formatInstant(value, display), [display])
  const time = React.useCallback((value: string | Date) => formatInstantTime(value, display), [display])
  return { dateFormat: display.dateFormat, timeZone: display.timeZone, formatDate, formatDateOnly: dateOnly, formatDateTime: dateTime, formatTime: time }
}
