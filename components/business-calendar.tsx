"use client"
import * as React from "react"
import type { ScheduleComponent, DragEventArgs } from "@syncfusion/ej2-react-schedule"
import { Calendar } from "./calendar"
import { toISODateLocal } from "@/lib/date"

export type BusinessCalendarEntry = { id: string; title: string; date: string; startsAt: string | null; endsAt: string | null; editable: boolean; color: string }
export type BusinessCalendarMove = { id: string; date: string; startsLocal: string; endsLocal: string }
const localDate = (date: string) => new Date(`${date}T00:00:00`)
const localStamp = (date: Date) => `${toISODateLocal(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`

// Controlled calendar: the caller owns authorization, persistence and conflict handling.
export function BusinessCalendar({ entries, timeZone, firstDayOfWeek, today, busy, onRange, onOpen, onCreate, onMove }: {
  entries: BusinessCalendarEntry[]; timeZone: string; firstDayOfWeek: number; today: string; busy: boolean;
  onRange: (from: string, to: string) => void; onOpen: (id: string) => void;
  onCreate: (date: string, startsLocal: string, endsLocal: string) => void; onMove: (move: BusinessCalendarMove) => void;
}) {
  const ref = React.useRef<ScheduleComponent | null>(null)
  const data = React.useMemo(() => entries.map(entry => {
    const start = entry.startsAt ? new Date(entry.startsAt) : localDate(entry.date)
    const end = entry.endsAt ? new Date(entry.endsAt) : localDate(entry.date)
    if (!entry.endsAt) end.setDate(end.getDate() + 1)
    return { Id: entry.id, Subject: entry.title, StartTime: start, EndTime: end, IsAllDay: !entry.startsAt, IsReadonly: !entry.editable || busy, Color: entry.color }
  }), [entries, busy])
  const syncRange = React.useCallback(() => {
    const dates = ref.current?.getCurrentViewDates()
    if (!dates?.length) return
    const end = new Date(dates[dates.length - 1]); end.setDate(end.getDate() + 1)
    onRange(toISODateLocal(dates[0]), toISODateLocal(end))
  }, [onRange])
  function dropped(args: DragEventArgs) {
    args.cancel = true
    const value = args.data as { Id: string; StartTime: Date; EndTime: Date; IsAllDay: boolean }
    if (busy || !entries.some(entry => entry.id === value.Id && entry.editable)) return
    onMove({ id: value.Id, date: toISODateLocal(value.StartTime), startsLocal: value.IsAllDay ? "" : localStamp(value.StartTime), endsLocal: value.IsAllDay ? "" : localStamp(value.EndTime) })
  }
  return <Calendar scheduleRef={ref} views={["Day", "Week", "Month", "Agenda"]} timezone={timeZone} selectedDate={localDate(today)} currentView="Week" firstDayOfWeek={firstDayOfWeek} height="680px" showQuickInfo={false} allowDragAndDrop={!busy} allowResizing={false} enableHtmlSanitizer
    eventSettings={{ dataSource: data, allowAdding: false, allowDeleting: false, template: (event: { Subject: string }) => <div className="whitespace-normal break-words px-1 text-xs">{event.Subject}</div> }}
    created={syncRange} actionComplete={syncRange} popupOpen={args => { args.cancel = true }}
    eventClick={args => { args.cancel = true; onOpen(String((args.event as { Id: string }).Id)) }}
    cellClick={args => { args.cancel = true; if (!busy) onCreate(toISODateLocal(args.startTime), args.isAllDay ? "" : localStamp(args.startTime), args.isAllDay ? "" : localStamp(args.endTime)) }}
    dragStop={dropped} eventRendered={args => { args.element.style.backgroundColor = String((args.data as { Color: string }).Color) }} />
}
