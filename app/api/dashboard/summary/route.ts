import { moduleEnabled } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import { findAccessUser, assignedPermissions } from "@/platform/access/server"
import { canManageUsers, type Role as AccessRole } from "@/lib/permissions"
import { NextResponse } from "next/server"
import { AppointmentOrderStatus, AppointmentStatus, Role, UserStatus } from "@prisma/client"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { withCoreApi, actorSession } from "@/platform/core/api"
import type { BusinessActor } from "@/platform/policy"
import { salesDashboard } from "@/platform/dashboard/sales-summary"

const BOOKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
]

const REVENUE_STATUSES: AppointmentOrderStatus[] = [
  AppointmentOrderStatus.CONFIRMED,
  AppointmentOrderStatus.COMPLETED,
]

const firstDayIndexMap = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const

const addDays = (value: Date, days: number) => {
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

const dateKeyToUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`)
const addDaysToDateKey = (value: string, days: number) => {
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

const toDateKeyInTimeZone = (value: Date, timeZone: string) => {
  const parts = getDatePartsInTimeZone(value, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

const toDateLabelInTimeZone = (value: Date, timeZone: string) =>
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

const zonedDateTimeToUtc = (
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

const getRangeBounds = (
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

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = actorSession(actor)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized_or_invalid_tenant" })
    return withRequestId(authorized.error, logContext.requestId)
  }

  const { tenantId } = authorized.context

  try {
    return await runWithTenantDbContext(tenantId, async () => {
      const [accessUser, moduleFlags] = await Promise.all([
        authorized.context.sessionUserId ? findAccessUser(prisma, tenantId, authorized.context.sessionUserId) : null,
        prisma.tenantModule.findMany({ where: { tenantId }, select: { key: true, allowed: true, enabled: true } }),
      ])
      const canReadLeaves = !!accessUser && canManageUsers(accessUser.role as AccessRole) && moduleEnabled(moduleFlags, "leaves") && permits({ permissions: assignedPermissions(accessUser) }, "leaveApprovals.read")
      const canReadBookings = !!accessUser && canManageUsers(accessUser.role as AccessRole) && moduleEnabled(moduleFlags, "appointments") && permits({ permissions: assignedPermissions(accessUser) }, "appointments.read")
      const canReadServices = !!accessUser && canManageUsers(accessUser.role as AccessRole) && moduleEnabled(moduleFlags, "services") && permits({ permissions: assignedPermissions(accessUser) }, "services.read")
      const canReadStock = !!accessUser && canManageUsers(accessUser.role as AccessRole) && moduleEnabled(moduleFlags, "inventory") && permits({ permissions: assignedPermissions(accessUser) }, "inventoryProducts.read")

      const url = new URL(request.url)
      const range = (url.searchParams.get("range") || "week").toLowerCase()
      const startDateRaw = url.searchParams.get("startDate")
      const endDateRaw = url.searchParams.get("endDate")
      const debug = url.searchParams.get("debug") === "1"

      const settings = await prisma.appSetting.findUnique({
        where: { tenantId },
        select: { firstDayOfWeek: true, timeZone: true },
      })
      const timeZone = settings?.timeZone || "America/New_York"

      const bounds = getRangeBounds(
        range,
        (settings?.firstDayOfWeek ?? "SUNDAY") as keyof typeof firstDayIndexMap,
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

      const [
        periodOrders,
        todayOrders,
        periodAppointments,
        todayAppointments,
        distinctCustomers,
        pendingLeaves,
        activeServices,
        activeStaff,
        upcomingAppointments,
        lowStockProducts,
        appointmentStatusRows,
        topServiceLines,
        staffRangeAppointments,
        sales,
      ] = await Promise.all([
        canReadBookings ? prisma.appointmentOrder.findMany({
          where: {
            tenantId,
            status: { in: REVENUE_STATUSES },
            appointmentDate: {
              gte: periodStartDateOnly,
              lte: periodEndDateOnly,
            },
          },
          select: {
            id: true,
            appointmentDate: true,
            totalCents: true,
          },
        }) : Promise.resolve([]),
        canReadBookings ? prisma.appointmentOrder.findMany({
          where: {
            tenantId,
            status: { in: REVENUE_STATUSES },
            appointmentDate: { gte: todayDateOnly, lte: todayDateOnly },
          },
          select: { totalCents: true },
        }) : Promise.resolve([]),
        canReadBookings ? prisma.appointment.findMany({
          where: {
            tenantId,
            startAt: { gte: rangeStart, lt: rangeEndExclusive },
          },
          select: { id: true, startAt: true, status: true, customerId: true },
        }) : Promise.resolve([]),
        canReadBookings ? prisma.appointment.findMany({
          where: {
            tenantId,
            startAt: { gte: todayStart, lt: tomorrowStart },
          },
          select: {
            id: true,
            staffProfileId: true,
            startAt: true,
            endAt: true,
          },
        }) : Promise.resolve([]),
        canReadBookings ? prisma.appointment.findMany({
          where: {
            tenantId,
            startAt: { gte: rangeStart, lt: rangeEndExclusive },
          },
          distinct: ["customerId"],
          select: { customerId: true },
        }) : Promise.resolve([]),
        canReadLeaves ? prisma.leaveRequest.count({
          where: {
            tenantId,
            status: "PENDING",
            ...(accessUser?.role === "MANAGER" ? { staffProfile: { managerUserId: authorized.context.sessionUserId, user: { role: "STAFF" as const } } } : {}),
          },
        }) : Promise.resolve(0),
        canReadServices ? prisma.service.count({
          where: {
            tenantId,
            status: "ACTIVE",
          },
        }) : Promise.resolve(0),
        canManageUsers(actor.role as AccessRole) && permits(actor, "users.read") ? prisma.user.count({
          where: { tenantId, role: Role.STAFF, status: UserStatus.ACTIVE },
        }) : Promise.resolve(0),
        canReadBookings ? prisma.appointment.findMany({
          where: {
            tenantId,
            startAt: { gte: new Date() },
            status: {
              in: [
                AppointmentStatus.SCHEDULED,
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.IN_PROGRESS,
              ],
            },
          },
          orderBy: { startAt: "asc" },
          take: 8,
          select: {
            id: true,
            startAt: true,
            status: true,
            customer: { select: { name: true } },
            service: { select: { name: true, priceCents: true } },
            staffProfile: { select: { user: { select: { name: true } } } },
          },
        }) : Promise.resolve([]),
        canReadStock ? prisma.inventoryProduct.findMany({
          where: {
            tenantId,
            status: "ACTIVE",
            onHandQty: { lte: prisma.inventoryProduct.fields.reorderPoint },
          },
          orderBy: [{ onHandQty: "asc" }, { updatedAt: "desc" }],
          take: 8,
          select: {
            id: true,
            sku: true,
            name: true,
            onHandQty: true,
            reorderPoint: true,
            reorderQty: true,
            category: { select: { name: true } },
          },
        }) : Promise.resolve([]),
        canReadBookings ? prisma.appointment.groupBy({
          by: ["status"],
          where: {
            tenantId,
            startAt: { gte: rangeStart, lt: rangeEndExclusive },
          },
          _count: { _all: true },
        }) : Promise.resolve([]),
        canReadBookings && canReadServices ? prisma.appointmentOrderLine.findMany({
          where: {
            order: {
              tenantId,
              status: { in: REVENUE_STATUSES },
              appointmentDate: {
                gte: periodStartDateOnly,
                lte: periodEndDateOnly,
              },
            },
          },
          select: {
            serviceId: true,
            lineTotalCents: true,
            service: { select: { name: true } },
          },
        }) : Promise.resolve([]),
        canReadBookings ? prisma.appointment.findMany({
          where: {
            tenantId,
            startAt: { gte: rangeStart, lt: rangeEndExclusive },
            status: { in: BOOKING_STATUSES },
          },
          select: {
            staffProfileId: true,
            startAt: true,
            endAt: true,
            staffProfile: { select: { user: { select: { name: true } } } },
          },
        }) : Promise.resolve([]),
        salesDashboard(prisma, actor, moduleFlags, { start: rangeStart, end: rangeEndExclusive, now, today: todayDateKey }),
      ])

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
        sales,
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
            host: request.headers.get("host"),
            forwardedHost: request.headers.get("x-forwarded-host"),
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

      const response = NextResponse.json(payload)
      logApiRequestSuccess(logContext, 200, {
        range: payload.range.label,
        points: payload.series.daily.length,
        upcomingCount: payload.upcomingAppointments.length,
      })
      return withRequestId(response, logContext.requestId)
    })
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load dashboard summary." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withCoreApi(request, "dashboard", "read", actor => handleGET(request, actor))
}
