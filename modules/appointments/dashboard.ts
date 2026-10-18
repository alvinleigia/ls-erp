import type { Prisma } from "@prisma/client"
import { moduleEnabled, type ModuleFlag } from "@/platform/modules"
import { permits } from "@/platform/access/policy"
import { canManageUsers, type Role } from "@/lib/permissions"
import type { BusinessActor } from "@/platform/policy"
import { AppointmentOrderStatus, AppointmentStatus } from "@prisma/client"
import type { OperationalDashboardPeriod } from "@/types/dashboard"

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

export async function appointmentsDashboardData(tx: Prisma.TransactionClient, actor: BusinessActor, flags: ModuleFlag[], period: OperationalDashboardPeriod) {
  const { tenantId } = actor
  const canReadBookings = canManageUsers(actor.role as Role) && moduleEnabled(flags, "appointments") && permits(actor, "appointments.read")
  const canReadServices = canManageUsers(actor.role as Role) && moduleEnabled(flags, "services") && permits(actor, "services.read")
  const { rangeStart, rangeEndExclusive, todayStart, tomorrowStart, periodStartDateOnly, periodEndDateOnly, todayDateOnly, now } = period
  const [periodOrders, todayOrders, periodAppointments, todayAppointments, distinctCustomers, upcomingAppointments, appointmentStatusRows, topServiceLines, staffRangeAppointments] = await Promise.all([
    canReadBookings ? tx.appointmentOrder.findMany({
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
    canReadBookings ? tx.appointmentOrder.findMany({
      where: {
        tenantId,
        status: { in: REVENUE_STATUSES },
        appointmentDate: { gte: todayDateOnly, lte: todayDateOnly },
      },
      select: { totalCents: true },
    }) : Promise.resolve([]),
    canReadBookings ? tx.appointment.findMany({
      where: {
        tenantId,
        startAt: { gte: rangeStart, lt: rangeEndExclusive },
      },
      select: { id: true, startAt: true, status: true, customerId: true },
    }) : Promise.resolve([]),
    canReadBookings ? tx.appointment.findMany({
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
    canReadBookings ? tx.appointment.findMany({
      where: {
        tenantId,
        startAt: { gte: rangeStart, lt: rangeEndExclusive },
      },
      distinct: ["customerId"],
      select: { customerId: true },
    }) : Promise.resolve([]),
    canReadBookings ? tx.appointment.findMany({
      where: {
        tenantId,
        startAt: { gte: now },
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
    canReadBookings ? tx.appointment.groupBy({
      by: ["status"],
      where: {
        tenantId,
        startAt: { gte: rangeStart, lt: rangeEndExclusive },
      },
      _count: { _all: true },
    }) : Promise.resolve([]),
    canReadBookings && canReadServices ? tx.appointmentOrderLine.findMany({
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
    canReadBookings ? tx.appointment.findMany({
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
  ])
  return { visible: canReadBookings, periodOrders, todayOrders, periodAppointments, todayAppointments, distinctCustomers, upcomingAppointments, appointmentStatusRows, topServiceLines, staffRangeAppointments }
}
