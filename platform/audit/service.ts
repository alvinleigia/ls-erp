import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, type BusinessActor } from "../policy"
import { authorizeBusinessOperation } from "../access/operation"
import { auditScope, securityEventSql } from "./policy"
import { auditChanges, redactAudit } from "./format"
import { startOfBusinessDate } from "@/lib/business-time"
import { addDaysToDateKey } from "@/application/dashboard/period"
import type { AuditLogReportRow, AuditLogReportResponse, AuditLogDetail, ReportDateContext } from "@/types/reports"

export const auditQuerySchema = z.object({
 page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
 q: z.string().trim().max(200).optional(), event: z.string().trim().max(150).optional(), entityType: z.string().trim().max(100).optional(),
 entityId: z.string().trim().max(150).optional(), actorUserId: z.string().trim().max(100).optional(), requestId: z.string().trim().max(150).optional(),
 dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(), category: z.enum(["all", "security", "business"]).default("all"),
 sort: z.enum(["createdAt", "event", "entityType"]).default("createdAt"), order: z.enum(["asc", "desc"]).default("desc"),
}).strict().refine(q => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, { path: ["dateTo"], message: "End date must be on or after start date." })
  .refine(q => q.dateTo !== "9999-12-31", { path: ["dateTo"], message: "Date to is outside the supported range." })
const header = Prisma.sql`a.id, a.event, a."entityType", a."entityId", a."actorUserId", a."actorRole", a."requestId", u.name AS "actorName", u.email AS "actorEmail"`
const source = Prisma.sql`FROM "AuditLog" a LEFT JOIN "User" u ON u.id=a."actorUserId" AND u."tenantId"=a."tenantId"`
type RawRow = Omit<AuditLogReportRow, "createdAt"> & { createdAt: Date }
const serialize = (row: RawRow): AuditLogReportRow => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })

export function createAuditReportService(db: PrismaClient, identity: Pick<BusinessActor, "tenantId" | "userId">) {
 function run<T>(operation: (tx: Prisma.TransactionClient, actor: BusinessActor, scope: Prisma.Sql, context: ReportDateContext) => Promise<T>) {
  return db.$transaction(async tx => {
   // Security administration uses this tenant row lock. Read Committed is
   // deliberate: authorization must see changes committed while this read waited.
   // No advisory lock is held here: writers can acquire it before this row lock.
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR SHARE`
   const actor = await authorizeBusinessOperation(tx, identity, "auditLogs.read")
   const settings = await tx.appSetting.findUnique({ where: { tenantId: identity.tenantId }, select: { timeZone: true, dateFormat: true, timeFormat: true } })
   const context = { timeZone: settings?.timeZone ?? "America/New_York", dateFormat: settings?.dateFormat ?? "MM/dd/yyyy", timeFormat: settings?.timeFormat ?? "H24" }
   return operation(tx, actor, Prisma.sql`a."tenantId"=${identity.tenantId} AND (${await auditScope(tx, actor)})`, context)
  }, { maxWait: 10000, timeout: 30000 })
 }
 return {
  list(input: unknown): Promise<AuditLogReportResponse> {
   const q = auditQuerySchema.parse(input)
   return run(async (tx, actor, scope, context) => {
    const filters = [scope]
    if (q.category !== "all") filters.push(q.category === "security" ? securityEventSql : Prisma.sql`NOT ${securityEventSql}`)
    const columns = { event: Prisma.sql`a.event`, entityType: Prisma.sql`a."entityType"`, entityId: Prisma.sql`a."entityId"`, actorUserId: Prisma.sql`a."actorUserId"`, requestId: Prisma.sql`a."requestId"` }
    for (const key of ["event", "entityType", "entityId", "actorUserId", "requestId"] as const) if (q[key]) filters.push(key === "event" ? Prisma.sql`strpos(lower(${columns[key]}), lower(${q[key]}))>0` : Prisma.sql`${columns[key]}=${q[key]}`)
    if (q.q) filters.push(Prisma.sql`(${Prisma.join([...Object.values(columns).filter(column => column !== columns.actorUserId), Prisma.sql`u.name`, Prisma.sql`u.email`].map(column => Prisma.sql`strpos(lower(${column}), lower(${q.q}))>0`), " OR ")})`)
    if (q.dateFrom) filters.push(Prisma.sql`a."createdAt">=(${startOfBusinessDate(q.dateFrom, context.timeZone)}::timestamptz AT TIME ZONE 'UTC')`)
    if (q.dateTo) filters.push(Prisma.sql`a."createdAt"<(${startOfBusinessDate(addDaysToDateKey(q.dateTo, 1), context.timeZone)}::timestamptz AT TIME ZONE 'UTC')`)
    const where = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    const sort = { createdAt: Prisma.sql`a."createdAt"`, event: Prisma.sql`a.event`, entityType: Prisma.sql`a."entityType"` }[q.sort]
    const order = q.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`
    const itemSort = { createdAt: Prisma.sql`p."createdAt"`, event: Prisma.sql`p.event`, entityType: Prisma.sql`p."entityType"` }[q.sort]
    // Counts and paged headers use one statement snapshot, even when another
    // module appends audit entries without the scheduling advisory lock.
    const [result] = await tx.$queryRaw<{ total: number; items: RawRow[] }[]>`
      SELECT (SELECT count(*)::integer ${source} ${where}) AS total,
       COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${itemSort} ${order}, p.id ${order}) FROM
        (SELECT ${header}, a."createdAt" AT TIME ZONE 'UTC' AS "createdAt" ${source} ${where}
         ORDER BY ${sort} ${order}, a.id ${order} LIMIT ${q.pageSize} OFFSET ${(q.page-1)*q.pageSize}) p), '[]'::jsonb) AS items`
    return { items: result.items.map(serialize), total: result.total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(result.total/q.pageSize)), canReviewSecurity: actor.role === "ADMIN", context }
   })
  },
  get(id: string): Promise<AuditLogDetail> {
   z.string().min(1).max(150).parse(id)
   return run(async (tx, _actor, scope, context) => {
    const [row] = await tx.$queryRaw<(RawRow & { metadata: unknown; before: unknown; after: unknown })[]>`SELECT ${header}, a."createdAt", a.metadata, a.before, a.after ${source} WHERE (${scope}) AND a.id=${id} LIMIT 1`
    if (!row) throw new BusinessError(404, "Audit entry not found or no longer accessible.")
    const before = redactAudit(row.before), after = redactAudit(row.after)
    return { ...serialize(row), metadata: redactAudit(row.metadata), before, after, changes: auditChanges(before, after), context }
   })
  },
 }
}
