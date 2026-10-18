"use client"

import { ActivityCalendar } from "@/modules/crm/components/activity-calendar"
import Link from "next/link"
import { CalendarUnavailable } from "@/components/calendar"
import { Button } from "@/components/ui/button"
import { calendarViewsEnabled } from "@/lib/calendar-features"
import { AccessPageHeader } from "@/platform/access/record-page"
import { pageClass } from "@/components/erp/page"

export default function Page() {
  if (calendarViewsEnabled) return <ActivityCalendar />
  return <section className={pageClass}>
    <AccessPageHeader title="Activity calendar" actions={<Button asChild><Link href="/crm/activities">My Work</Link></Button>} />
    <CalendarUnavailable />
    <p className="text-sm text-muted-foreground">View, schedule and update activities in My Work.</p>
  </section>
}
