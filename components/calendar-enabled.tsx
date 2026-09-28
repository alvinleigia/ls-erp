"use client"

import { registerLicense } from "@syncfusion/ej2-base"
import { ScheduleComponent, Day, Week, Month, Agenda, DragAndDrop, Inject, ViewsDirective, ViewDirective, ResourcesDirective, ResourceDirective } from "@syncfusion/ej2-react-schedule"
import type { CalendarProps } from "./calendar"
import "./calendar-enabled.css"

const key = process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY
if (key) registerLicense(key)

export default function EnabledCalendar({ scheduleRef, views, resources, ...props }: CalendarProps) {
  return <ScheduleComponent {...props} ref={scheduleRef}>
    <ViewsDirective>{views.map(view => <ViewDirective key={view} option={view} />)}</ViewsDirective>
    {resources && <ResourcesDirective>{resources.map(resource => <ResourceDirective key={resource.name} {...resource} />)}</ResourcesDirective>}
    <Inject services={[Day, Week, Month, Agenda, DragAndDrop]} />
  </ScheduleComponent>
}
