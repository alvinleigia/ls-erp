import type { Prisma } from "@prisma/client"

export const appointmentInclude = {
  customer: { select: { id: true, name: true, email: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
  staffProfile: { select: { id: true, user: { select: { id: true, name: true, email: true } } } },
  orderLine: { select: { id: true, order: { select: { id: true, status: true } } } },
} satisfies Prisma.AppointmentInclude

export const appointmentDetailInclude = {
  ...appointmentInclude,
  service: { select: { ...appointmentInclude.service.select, priceCents: true } },
} satisfies Prisma.AppointmentInclude

export function serializeAppointment<T extends { startAt: Date; endAt: Date; createdAt: Date; updatedAt: Date }>(appointment: T) {
  return {
    ...appointment,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  }
}
