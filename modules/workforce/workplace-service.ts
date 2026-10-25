import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { staffWorkplaceSchema } from "@/lib/validation"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { scheduleTransaction } from "./schedule-transaction"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
export type Workplace = { id: string; officeId: string; officeName: string; companyName: string; startDate: string | null; endDate: string | null; canceledAt: string | null }
export type WorkplaceView = { version: number; today: string; items: Workplace[]; total: number; current: Workplace | null; latest: Workplace | null; canAssign: boolean; canCancel: boolean }
export const workplaceQuerySchema = z.object({
  staffId: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(160).default(""),
}).strict()
type Query = z.infer<typeof workplaceQuerySchema>
export function readStaffWorkplace(identity: Identity, query: Query) {
  return prisma.$transaction(async tx => {
    await authorizeBusinessOperation(tx, identity, "shiftRoster.read", ["shifts"])
    const [row] = await tx.$queryRaw<{ view: WorkplaceView | null }[]>`SELECT app.staff_workplace_view(${identity.tenantId},${query.staffId},${query.pageSize}::integer,${(query.page - 1) * query.pageSize}::integer) AS view`
    if (!row?.view) throw new BusinessError(404, "Staff workplace target not found.")
    return row.view
  })
}
export function listWorkplaceOffices(identity: Identity, query: Query) {
  return prisma.$transaction(async tx => {
    await authorizeBusinessOperation(tx, identity, "shiftRoster.edit", ["shifts"])
    const [row] = await tx.$queryRaw<{ view: { items: { id: string; name: string }[]; total: number } | null }[]>`SELECT app.staff_workplace_offices(${identity.tenantId},${query.staffId},${query.q},${query.pageSize}::integer,${(query.page - 1) * query.pageSize}::integer) AS view`
    if (!row?.view) throw new BusinessError(404, "Staff workplace target not found.")
    return row.view
  })
}
export function changeStaffWorkplace(identity: Identity, input: z.infer<typeof staffWorkplaceSchema>) {
  return scheduleTransaction(identity.tenantId, async tx => {
    // Same order as the database writer and user administration. Permissions and
    // office memberships cannot be revoked between this check and the mutation.
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
    await authorizeBusinessOperation(tx, identity, input.action === "cancel" ? ["shiftRoster.edit", "shiftRoster.archive"] : "shiftRoster.edit", ["shifts"])
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT app.change_staff_workplace(${identity.tenantId},${input.staffId},${input.version}::integer,${input.action === "assign" ? input.officeId : null},${input.action === "assign" ? input.startsOn : null}::date,${input.action === "assign" ? input.fromId ?? null : null},${input.action === "cancel" ? input.assignmentId : null},${identity.requestId ?? null}) AS id`
    return { id: row.id }
  })
}
