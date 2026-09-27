"use client"

import * as React from "react"

import { DEFAULT_DATE_FORMAT, formatDateForDisplay } from "@/lib/date"

type SettingsResponse = { settings?: { dateFormat?: string } }

let cachedDateFormat: string | null = null
let pending: Promise<string | null> | null = null

const loadDateFormat = async () => {
  if (cachedDateFormat) {
    return cachedDateFormat
  }
  if (!pending) {
    pending = fetch("/api/settings/display", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null
        const data = (await response.json()) as SettingsResponse
        const format = data.settings?.dateFormat ?? null
        cachedDateFormat = format
        return format
      })
      .catch(() => null)
      .finally(() => {
        pending = null
      })
  }
  return pending
}

export const useDateFormatter = () => {
  const [dateFormat, setDateFormat] = React.useState<string | null>(
    cachedDateFormat
  )

  React.useEffect(() => {
    if (dateFormat) return
    void loadDateFormat().then((format) => {
      if (format) {
        setDateFormat(format)
      }
    })
  }, [dateFormat])

  const formatDate = React.useCallback(
    (value?: string | Date | null) =>
      formatDateForDisplay(value, dateFormat ?? DEFAULT_DATE_FORMAT),
    [dateFormat]
  )

  return { dateFormat: dateFormat ?? DEFAULT_DATE_FORMAT, formatDate }
}
