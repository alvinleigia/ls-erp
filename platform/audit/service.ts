import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, type BusinessActor } from "../policy"
import { assignedPermissions, findAccessUser } from "../access/server"
import { requirePermission } from "../access/policy"
import { auditScope, securityEvents } from "./policy"
import { auditChanges, redactAudit } from "./format"

export const auditQuerySchema = z.object({
 page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
 q: z.string().trim().max(200).optional(), event: z.string().trim().max(150).optional(), entityType: z.string().trim().max(100).optional(),
 entityId: z.string().trim().max(150).optional(), actorUserId: z.string().trim().max(100).optional(), requestId: z.string().trim().max(150).optional(),
 dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(), category: z.enum(["all", "security", "business"]).default("all"),
 sort: z.enum(["createdAt", "event", "entityType"]).default("createdAt"), order: z.enum(["asc", "desc"]).default("desc"),
}).strict().refine(q => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, { path: ["dateTo"], message: "End date must be on or after start date." })
const header = { id: true, event: true, entityType: true, entityId: true, actorUserId: true, actorRole: true, requestId: true, createdAt: true, actorUser: { select: { id: true, name: true, email: true } } } as const
function serialize<T extends { createdAt: Date; actorUser: { name: string | null; email: string | null } | null }>(row: T) {
 const { actorUser, ...rest } = row
 return { ...rest, createdAt: row.createdAt.toISOString(), actorName: actorUser?.name ?? null, actorEmail: actorUser?.email ?? null }
}
export function createAuditReportService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId">) {
 // Authority and rows share one snapshot; repeat requests always recheck current access.
 function run<T>(operation: (tx: Prisma.TransactionClient, actor: BusinessActor, scope: Prisma.AuditLogWhereInput) => Promise<T>) {
  return db.$transaction(async tx => {
   const user = await findAccessUser(tx, identity.tenantId, identity.userId)
   if (!user || !["ADMIN", "MANAGER"].includes(user.role) || user.tenant.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Audit reports require administrator or manager access.")
   const actor = { ...identity, role: user.role, permissions: assignedPermissions(user) }
   requirePermission(actor, "auditLogs.read")
   return operation(tx, actor, await auditScope(tx, actor))
  }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 15000 })
 }
 return {
  list(input: unknown) {
   const q = auditQuerySchema.parse(input)
   return run(async (tx, actor, scope) => {
    const where: Prisma.AuditLogWhereInput = { AND: [scope,
     ...(q.category === "security" ? [securityEvents] : q.category === "business" ? [{ NOT: securityEvents }] : []),
     ...(q.q ? [{ OR: [...["event", "entityType", "entityId", "requestId"].map(key => ({ [key]: { contains: q.q, mode: Prisma.QueryMode.insensitive } })), { actorUser: { name: { contains: q.q, mode: Prisma.QueryMode.insensitive } } }, { actorUser: { email: { contains: q.q, mode: Prisma.QueryMode.insensitive } } }] }] : []),
    ], ...(q.event ? { event: { contains: q.event, mode: "insensitive" } } : {}), ...(q.entityType ? { entityType: q.entityType } : {}),
     ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}), ...(q.requestId ? { requestId: q.requestId } : {}),
     ...(q.dateFrom || q.dateTo ? { createdAt: { ...(q.dateFrom ? { gte: new Date(`${q.dateFrom}T00:00:00Z`) } : {}), ...(q.dateTo ? { lte: new Date(`${q.dateTo}T23:59:59.999Z`) } : {}) } } : {}),
    }
    const total = await tx.auditLog.count({ where })
    const items = await tx.auditLog.findMany({ where, select: header, orderBy: [{ [q.sort]: q.order }, { id: q.order }], skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    return { items: items.map(serialize), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), canReviewSecurity: actor.role === "ADMIN" }
   })
  },
  get(id: string) {
   z.string().min(1).max(150).parse(id)
   return run(async (tx, _actor, scope) => {
    const row = await tx.auditLog.findFirst({ where: { AND: [scope, { id }] }, select: { ...header, metadata: true, before: true, after: true } })
    if (!row) throw new BusinessError(404, "Audit entry not found or no longer accessible.")
    const before = redactAudit(row.before), after = redactAudit(row.after)
    return { ...serialize(row), metadata: redactAudit(row.metadata), before, after, changes: auditChanges(before, after) }
   })
  },
 }
}
