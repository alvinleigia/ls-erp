"use client"

import dynamic from "next/dynamic"
import type { Ref } from "react"
import type { ScheduleComponent, ScheduleModel, ResourcesModel, EventSettingsModel, FieldModel } from "@syncfusion/ej2-react-schedule"
import { calendarViewsEnabled } from "@/lib/calendar-features"
import { useListState } from "@/components/erp/list-navigation"

export type CalendarProps = Omit<ScheduleModel, "views" | "resources" | "eventSettings"> & {
  scheduleRef?: Ref<ScheduleComponent>
  persistSelectedDate?: boolean
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

export function Calendar({ persistSelectedDate = true, ...props }: CalendarProps) {
  const [date, setDate] = useListState("calendar", "date", props.selectedDate || new Date())
  const [view, setView] = useListState("calendar", "view", props.currentView || "Week", { validate: value => typeof value === "string" && props.views.includes(value as CalendarProps["views"][number]) })
  return EnabledCalendar ? <EnabledCalendar {...props} selectedDate={persistSelectedDate ? date : props.selectedDate} currentView={view} navigating={args => {
    if (typeof props.navigating === "function") props.navigating(args)
    if (args.cancel) return
    if (persistSelectedDate && args.currentDate instanceof Date) setDate(args.currentDate)
    if (args.currentView && props.views.includes(args.currentView as CalendarProps["views"][number])) setView(args.currentView as NonNullable<CalendarProps["currentView"]>)
  }} /> : <CalendarUnavailable />
}
