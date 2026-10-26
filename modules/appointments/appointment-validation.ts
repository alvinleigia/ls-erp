import { z } from "zod"

export const appointmentListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  staffId: z.string().trim().optional(),
  officeId: z.string().trim().min(1).max(160).optional(),
  customerId: z.string().trim().optional(),
  status: z.enum(["SCHEDULED", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELED", "NO_SHOW"]).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  sort: z.enum(["startAt", "endAt", "createdAt", "updatedAt", "status"]).default("startAt"),
  order: z.enum(["asc", "desc"]).default("asc"),
}).refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: "End date must be on or after start date.", path: ["endDate"],
})

export const appointmentAvailabilitySchema = z.object({
  appointmentId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  serviceId: z.string().trim().min(1),
  staffId: z.string().trim().min(1),
  startAt: z.string().datetime({ offset: true }),
})

export type AppointmentListInput = z.infer<typeof appointmentListSchema>
export type AppointmentAvailabilityInput = z.infer<typeof appointmentAvailabilitySchema>
