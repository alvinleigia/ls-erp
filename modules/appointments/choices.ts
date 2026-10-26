import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { startOfBusinessDate } from "@/lib/business-time"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import type { AppointmentStaffChoice } from "@/types/appointments"
import type { RecordOffice } from "@/types/companies"

const paging = { q: z.string().trim().max(160).default(""), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }
export const bookingOfficeChoicesSchema = z.object({ ...paging, selected: z.string().max(160).optional() }).strict()
export const bookingStaffChoicesSchema = z.object({ ...paging,
  family: z.enum(["APPOINTMENT", "ORDER"]), action: z.enum(["browse", "create", "edit"]),
  sourceId: z.string().min(1).max(160).optional(), officeId: z.string().min(1).max(160).optional(),
  startAt: z.iso.datetime({ offset: true }).optional(), endAt: z.iso.datetime({ offset: true }).optional(),
  startDate: z.iso.date().optional(), endDate: z.iso.date().optional(), selected: z.string().max(16100).default(""),
}).strict().refine(v => v.selected.split(",").filter(Boolean).length <= 100, "Select at most 100 staff.")
  .refine(v => v.action === "browse" ? !v.sourceId && !v.startAt && !v.endAt && (!v.startDate || !v.endDate || v.startDate <= v.endDate)
    : !!v.startAt && !!v.endAt && Date.parse(v.endAt) > Date.parse(v.startAt) && !v.officeId && !v.startDate && !v.endDate && (v.action === "edit" ? !!v.sourceId : !v.sourceId), "Choose a valid booking source and time window.")

export async function bookingStaffChoices(actor: BusinessActor, query: z.infer<typeof bookingStaffChoicesSchema>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`workforce-schedules:${actor.tenantId}`}, 0))`
    await authorizeBusinessOperation(tx, actor, `appointments.${query.action === "browse" ? "read" : query.action}`, ["appointments"])
    // Respect ordinary source RLS as well as the native office predicate. A
    // caller cannot resolve retained assignees by supplying a hidden source ID.
    if (query.action === "edit") {
      const where = { tenantId: actor.tenantId, id: query.sourceId }
      const source = query.family === "ORDER" ? await tx.appointmentOrder.findFirst({ where, select: { id: true } }) : await tx.appointment.findFirst({ where, select: { id: true } })
      if (!source) throw new BusinessError(404, "Booking staff source not found.")
    }
    const settings = query.action === "browse" ? await tx.appSetting.findUnique({ where: { tenantId: actor.tenantId }, select: { timeZone: true } }) : null
    const nextDate = query.endDate ? new Date(`${query.endDate}T00:00:00Z`) : null
    if (nextDate) nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const first = query.startAt ? new Date(query.startAt) : query.startDate ? startOfBusinessDate(query.startDate, settings?.timeZone || "America/New_York") : null
    const last = query.endAt ? new Date(query.endAt) : nextDate ? startOfBusinessDate(nextDate.toISOString().slice(0, 10), settings?.timeZone || "America/New_York") : null
    const [row] = await tx.$queryRaw<{ view: { items: AppointmentStaffChoice[]; selected: AppointmentStaffChoice[]; total: number; office: RecordOffice | null } }[]>`SELECT app.booking_staff_choices(${actor.tenantId},${query.family},${query.action},${query.sourceId ?? null},${query.officeId ?? null},${first}::timestamptz,${last}::timestamptz,${query.selected.split(",").filter(Boolean)}::text[],${query.q},${query.pageSize}::integer,${(query.page - 1) * query.pageSize}::integer) AS view`
    return { ...row.view, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(row.view.total / query.pageSize)) }
  }, { timeout: 30_000 })
}
export async function bookingOfficeChoices(actor: BusinessActor, query: z.infer<typeof bookingOfficeChoicesSchema>) {
  const [row] = await prisma.$queryRaw<{ view: { items: RecordOffice[]; selected: RecordOffice | null; total: number } }[]>`SELECT app.booking_office_choices(${actor.tenantId},${query.selected ?? null},${query.q},${query.pageSize}::integer,${(query.page - 1) * query.pageSize}::integer) AS view`
  return { ...row.view, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(row.view.total / query.pageSize)) }
}
