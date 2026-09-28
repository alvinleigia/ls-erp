"use client"

import dynamic from "next/dynamic"
import type { Ref } from "react"
import type { ScheduleComponent, ScheduleModel, ResourcesModel, EventSettingsModel, FieldModel } from "@syncfusion/ej2-react-schedule"
import { calendarViewsEnabled } from "@/lib/calendar-features"

export type CalendarProps = Omit<ScheduleModel, "views" | "resources" | "eventSettings"> & {
  scheduleRef?: Ref<ScheduleComponent>
  views: ("Day" | "Week" | "Month" | "Agenda")[]
  resources?: ResourcesModel[]
  eventSettings?: Omit<EventSettingsModel, "fields"> & {
    fields?: FieldModel & { categoryColor?: { name: string } }
  }
}

// Do not initialize or download the vendor library while calendars are off.
const EnabledCalendar = calendarViewsEnabled
  ? dynamic(() => import("./calendar-enabled"), { ssr: false })
  : null

export function CalendarUnavailable() {
  return <p role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Calendar view is temporarily unavailable.</p>
}

export function Calendar(props: CalendarProps) {
  return EnabledCalendar ? <EnabledCalendar {...props} /> : <CalendarUnavailable />
}
