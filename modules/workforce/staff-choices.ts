import { requireBusinessModule } from "@/platform/module-server"
import { z } from "zod"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import type { BusinessActor } from "@/platform/policy"
import { prisma } from "@/lib/prisma"

export const staffChoicesSchema = z.object({
  family: z.enum(["SCHEDULE", "PATTERN"]), action: z.enum(["browse", "create", "edit"]),
  sourceId: z.string().trim().min(1).max(160).optional(), startDate: z.iso.date().optional(), endDate: z.iso.date().optional(),
  selected: z.string().max(16100).default(""), q: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(v => v.action === "browse" ? !v.sourceId : !!v.startDate && (!v.endDate || v.endDate >= v.startDate) && (v.action === "edit" ? !!v.sourceId : !v.sourceId), "Choose an office and valid assignment dates.")
  .refine(v => v.selected.split(",").filter(Boolean).length <= 100, "Select at most 100 staff.")

export async function workforceStaffChoices(actor: BusinessActor, input: unknown) {
  await requireBusinessModule(prisma, actor.tenantId, "shifts")
  const query = staffChoicesSchema.parse(input)
  return prisma.$transaction(async tx => {
    // Readers can share this lock. Scheduling/security mutations take its
    // exclusive counterpart; refresh permissions only after acquiring it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`workforce-schedules:${actor.tenantId}`}, 0))`
    const resource = query.family === "SCHEDULE" ? "shiftSchedules" : "shiftPlans"
    await authorizeBusinessOperation(tx, actor, `${resource}.${query.action === "browse" ? "read" : query.action}`, ["shifts"])
    const [row] = await tx.$queryRaw<{ view: { items: unknown[]; selected: unknown[]; total: number } }[]>`SELECT app.workforce_staff_choices(${actor.tenantId},${query.family},${query.action},${query.sourceId ?? null},${query.startDate ?? null}::date,${query.endDate ?? null}::date,${query.selected.split(",").filter(Boolean)}::text[],${query.q},${query.pageSize}::integer,${(query.page - 1) * query.pageSize}::integer) AS view`
    return { ...row.view, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(row.view.total / query.pageSize)) }
  }, { timeout: 30_000 })
}
