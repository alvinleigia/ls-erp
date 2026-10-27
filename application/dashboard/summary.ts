import { dateKeyToUtcDate, addDaysToDateKey } from "@/lib/business-time"
import { Role, UserStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { permits } from "@/platform/access/policy"
import type { BusinessActor } from "@/platform/policy"
import { createDashboardSalesService } from "./sales-service"
import type { AttributionFilter } from "@/platform/collaborators/report-validation"
import { appointmentsDashboardData } from "@/modules/appointments/dashboard"
import { workforceDashboardData } from "@/modules/workforce/dashboard"
import { servicesDashboardData } from "@/modules/services/dashboard"
import { inventoryDashboardData } from "@/modules/inventory/dashboard"
import { addDays, toDateKeyInTimeZone, toDateLabelInTimeZone, zonedDateTimeToUtc, getRangeBounds } from "./period"

// The HTTP entry point establishes current-account authorization and tenant DB context.
export async function dashboardSummary(actor: BusinessActor, options: {
  range: string; startDateRaw: string | null; endDateRaw: string | null;
  attribution?: AttributionFilter; debug?: boolean; host?: string | null; forwardedHost?: string | null;
}) {
  const { tenantId } = actor
  const { range, startDateRaw, endDateRaw, debug } = options
  const moduleFlags = await prisma.tenantModule.findMany({ where: { tenantId }, select: { key: true, allowed: true, enabled: true } })
  const settings = await prisma.appSetting.findUnique({
    where: { tenantId },
    select: { firstDayOfWeek: true, timeZone: true },
  })
  const timeZone = settings?.timeZone || "America/New_York"

  const bounds = getRangeBounds(
    range,
    (settings?.firstDayOfWeek ?? "SUNDAY") as Parameters<typeof getRangeBounds>[1],
    startDateRaw,
    endDateRaw,
    timeZone
  )

  const now = new Date()
  const todayDateKey = toDateKeyInTimeZone(now, timeZone)
  const tomorrowDateKey = addDaysToDateKey(todayDateKey, 1)
  const todayStart = zonedDateTimeToUtc(todayDateKey, timeZone, 0, 0)
  const tomorrowStart = zonedDateTimeToUtc(tomorrowDateKey, timeZone, 0, 0)
  const rangeStartDateKey = bounds.start.toISOString().slice(0, 10)
  const rangeEndDateKey = addDays(bounds.endExclusive, -1).toISOString().slice(0, 10)
  const rangeEndExclusiveDateKey = addDaysToDateKey(rangeEndDateKey, 1)
  const rangeStart = zonedDateTimeToUtc(rangeStartDateKey, timeZone, 0, 0)
  const rangeEndExclusive = zonedDateTimeToUtc(rangeEndExclusiveDateKey, timeZone, 0, 0)
  const periodStartDateOnly = dateKeyToUtcDate(rangeStartDateKey)
  const periodEndDateOnly = dateKeyToUtcDate(rangeEndDateKey)
  const todayDateOnly = dateKeyToUtcDate(todayDateKey)


  const [bookings, workforce, services, inventory, activeStaff, sales] = await Promise.all([
    appointmentsDashboardData(prisma, actor, moduleFlags, { rangeStart, rangeEndExclusive, todayStart, tomorrowStart, periodStartDateOnly, periodEndDateOnly, todayDateOnly, now }),
    workforceDashboardData(prisma, actor, moduleFlags),
    servicesDashboardData(prisma, actor, moduleFlags),
    inventoryDashboardData(prisma, actor, moduleFlags),
    permits(actor, "users.read") ? prisma.user.count({ where: { tenantId, collaboratorId: null, role: Role.STAFF, status: UserStatus.ACTIVE } }) : Promise.resolve(0),
    createDashboardSalesService(prisma, actor).summary({ range, startDate: startDateRaw || undefined, endDate: endDateRaw || undefined, ...options.attribution }, { start: rangeStart, end: rangeEndExclusive, now, today: todayDateKey }),
  ])
  const { visible: canReadBookings, periodOrders, todayOrders, periodAppointments, todayAppointments, distinctCustomers, upcomingAppointments, appointmentStatusRows, topServiceLines, staffRangeAppointments } = bookings
  const { visible: canReadLeaves, pendingLeaves } = workforce
  const { visible: canReadServices, activeServices } = services
  const { visible: canReadStock, lowStockProducts, office: stockOffice } = inventory

  const rangeDays = Math.max(
    1,
    Math.round((bounds.endExclusive.getTime() - bounds.start.getTime()) / (24 * 60 * 60 * 1000))
  )

  const daySeriesMap = new Map<string, { date: string; label: string; revenueCents: number; bookings: number }>()
  for (let cursor = new Date(bounds.start); cursor < bounds.endExclusive; cursor = addDays(cursor, 1)) {
    const key = cursor.toISOString().slice(0, 10)
    daySeriesMap.set(key, {
      date: key,
      label: toDateLabelInTimeZone(zonedDateTimeToUtc(key, timeZone), timeZone),
      revenueCents: 0,
      bookings: 0,
    })
  }

  for (const order of periodOrders) {
    const key = order.appointmentDate.toISOString().slice(0, 10)
    const point = daySeriesMap.get(key)
    if (!point) continue
    point.revenueCents += order.totalCents
  }

  for (const appointment of periodAppointments) {
    const key = toDateKeyInTimeZone(appointment.startAt, timeZone)
    const point = daySeriesMap.get(key)
    if (!point) continue
    point.bookings += 1
  }

  const topServiceMap = new Map<string, { serviceId: string; name: string; bookings: number; revenueCents: number }>()
  for (const line of topServiceLines) {
    const key = line.serviceId
    const current = topServiceMap.get(key) ?? {
      serviceId: line.serviceId,
      name: line.service?.name ?? "Unknown service",
      bookings: 0,
      revenueCents: 0,
    }
    current.bookings += 1
    current.revenueCents += line.lineTotalCents
    topServiceMap.set(key, current)
  }

  const staffMap = new Map<string, { staffProfileId: string; name: string; bookings: number; bookedMinutes: number }>()
  for (const row of staffRangeAppointments) {
    const key = row.staffProfileId
    const current = staffMap.get(key) ?? {
      staffProfileId: key,
      name: row.staffProfile.user.name?.trim() || "Staff",
      bookings: 0,
      bookedMinutes: 0,
    }
    current.bookings += 1
    const minutes = Math.max(0, Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60000))
    current.bookedMinutes += minutes
    staffMap.set(key, current)
  }

  const payload = {
    sales: sales.data,
    salesFilters: sales.metadata,
    visibility: {
      appointments: canReadBookings,
      leaves: canReadLeaves,
      services: canReadServices,
      inventory: canReadStock,
    },
    range: {
      label: bounds.label,
      startDate: rangeStartDateKey,
      endDate: rangeEndDateKey,
    },
    kpis: {
      revenueCents: periodOrders.reduce((sum, row) => sum + row.totalCents, 0),
      revenueTodayCents: todayOrders.reduce((sum, row) => sum + row.totalCents, 0),
      appointments: periodAppointments.length,
      appointmentsToday: todayAppointments.length,
      distinctCustomers: distinctCustomers.length,
      pendingLeaves,
      activeServices,
      activeStaff,
    },
    series: {
      daily: Array.from(daySeriesMap.values()),
    },
    appointmentStatus: appointmentStatusRows
      .map((row) => ({
        status: row.status,
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    topServices: Array.from(topServiceMap.values())
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 6),
    staffUtilization: Array.from(staffMap.values())
      .map((row) => ({
        ...row,
        utilizationPercent: Math.min(100, Math.round((row.bookedMinutes / (rangeDays * 8 * 60)) * 100)),
      }))
      .sort((a, b) => b.bookedMinutes - a.bookedMinutes)
      .slice(0, 6),
    upcomingAppointments: upcomingAppointments.map((row) => ({
      id: row.id,
      startAt: row.startAt.toISOString(),
      status: row.status,
      customerName: row.customer?.name?.trim() || "Customer",
      staffName: row.staffProfile.user.name?.trim() || "Staff",
      serviceName: row.service.name,
      priceCents: row.service.priceCents,
    })),
    stockOffice,
    lowStock: lowStockProducts.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      categoryName: row.category.name,
      onHandQty: row.onHandQty,
      reorderPoint: row.reorderPoint,
      reorderQty: row.reorderQty,
    })),
    generatedAt: new Date().toISOString(),
  }

  if (debug) {
    const daily = payload.series as { daily: Array<{ bookings: number; revenueCents: number }> }
    const appointmentStatus = payload.appointmentStatus as Array<{ count: number }>
    const staffUtilization = payload.staffUtilization as Array<{ bookings: number; bookedMinutes: number }>
    const topServices = payload.topServices as Array<{ bookings: number; revenueCents: number }>
    const kpis = payload.kpis as { appointments: number; revenueCents: number; appointmentsToday: number; revenueTodayCents: number }
    ;(payload as { debug?: unknown }).debug = {
      tenantId,
      request: {
        range,
        startDateRaw,
        endDateRaw,
        host: options.host ?? null,
        forwardedHost: options.forwardedHost ?? null,
      },
      computedBounds: {
        label: bounds.label,
        timeZone,
        rangeStart: rangeStart.toISOString(),
        rangeEndExclusive: rangeEndExclusive.toISOString(),
        start: bounds.start.toISOString(),
        endExclusive: bounds.endExclusive.toISOString(),
        todayStart: todayStart.toISOString(),
        tomorrowStart: tomorrowStart.toISOString(),
        periodStartDateOnly: periodStartDateOnly.toISOString(),
        periodEndDateOnly: periodEndDateOnly.toISOString(),
        todayDateOnly: todayDateOnly.toISOString(),
        rangeDays,
      },
      sourceCounts: {
        periodOrders: periodOrders.length,
        todayOrders: todayOrders.length,
        periodAppointments: periodAppointments.length,
        todayAppointments: todayAppointments.length,
        distinctCustomers: distinctCustomers.length,
        appointmentStatusRows: appointmentStatusRows.length,
        topServiceLines: topServiceLines.length,
        staffRangeAppointments: staffRangeAppointments.length,
        upcomingAppointments: upcomingAppointments.length,
        lowStockProducts: lowStockProducts.length,
      },
      derivedTotals: {
        kpiAppointments: kpis.appointments,
        dailyBookingsTotal: daily.daily.reduce((sum, row) => sum + row.bookings, 0),
        statusMixTotal: appointmentStatus.reduce((sum, row) => sum + row.count, 0),
        staffBookingsTotal: staffUtilization.reduce((sum, row) => sum + row.bookings, 0),
        staffBookedMinutesTotal: staffUtilization.reduce((sum, row) => sum + row.bookedMinutes, 0),
        topServicesBookingsTotal: topServices.reduce((sum, row) => sum + row.bookings, 0),
        kpiRevenueCents: kpis.revenueCents,
        dailyRevenueTotalCents: daily.daily.reduce((sum, row) => sum + row.revenueCents, 0),
        topServicesRevenueTotalCents: topServices.reduce((sum, row) => sum + row.revenueCents, 0),
        kpiAppointmentsToday: kpis.appointmentsToday,
        kpiRevenueTodayCents: kpis.revenueTodayCents,
      },
    }
  }

  return payload
}
