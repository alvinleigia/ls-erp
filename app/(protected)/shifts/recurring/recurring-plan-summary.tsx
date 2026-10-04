"use client"

import * as React from "react"
import { Section } from "@/components/erp/section"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import { WEEKDAY_OPTIONS } from "@/types/scheduling"
import type { StaffFlexiblePattern } from "@/types/shifts"

export function RecurringPlanSummary({ id }: { id: string }) {
  const [pattern, setPattern] = React.useState<StaffFlexiblePattern | null>(null)
  const [error, setError] = React.useState("")

  React.useEffect(() => {
    const controller = new AbortController()
    setPattern(null)
    setError("")
    void (async () => {
      try {
        const response = await fetch(`/api/shifts/flexible-patterns/${id}`, { cache: "no-store", signal: controller.signal })
        const data = await response.json() as { item?: StaffFlexiblePattern; error?: string }
        if (!response.ok || !data.item) throw new Error(data.error || "Unable to load weekly availability.")
        if (!controller.signal.aborted) setPattern(data.item)
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load weekly availability.")
      }
    })()
    return () => controller.abort()
  }, [id])

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!pattern) return <p role="status" className="text-sm text-muted-foreground">Loading weekly availability...</p>
  return <>{pattern.weeks.map(week => <Section key={week.weekIndex} title={`Week ${week.weekIndex}`}>
    <ReadOnlyFields fields={WEEKDAY_OPTIONS.map(option => {
      const day = week.days.find(item => item.day === option.value)
      return {
        label: option.label,
        value: !day || day.isOff ? "Off" : day.slots.length ? day.slots.map((slot, index) => <div key={index}>
          <p>{slot.startTime} – {slot.endTime}</p>
          {slot.breaks.length > 0 && <p className="text-xs text-muted-foreground">Breaks: {slot.breaks.map(item => `${item.startTime} – ${item.endTime}`).join(", ")}</p>}
        </div>) : "No availability",
      }
    })} />
  </Section>)}</>
}
