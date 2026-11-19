import { z } from "zod"
import type { Prisma } from "@prisma/client"
import type { Requirement } from "@/platform/access/catalog"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { projectScope } from "./access"
import { permits } from "@/platform/access/policy"
import { lockTenantOperations } from "@/platform/transactions/tenant-lock"

const phaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/),
  status: z.enum(["PLANNED", "OPEN", "PAUSED", "CLOSED"]),
  opensAt: z.string().datetime({ offset: true }).nullable().default(null),
  version: z.number().int().positive().optional(),
}).strict()
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(160).default(""),
})
type Tx = Prisma.TransactionClient
type Run = <T>(requirement: Requirement, operation: (tx: Tx, actor: BusinessActor) => Promise<T>) => Promise<T>

export function createLaunchPhaseService(run: Run) {
  async function rootProject(tx: Tx, actor: BusinessActor, id: string) {
    const node = await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor), { id }] }, select: { rootId: true } })
    const project = node && await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor), { id: node.rootId }] } })
    if (!project) throw new BusinessError(404, "Project not found.")
    return project
  }
  return {
    listLaunchPhases(projectId: string, input: unknown) {
      const query = querySchema.parse(input)
      return run("projects.read", async (tx, actor) => {
        const project = await rootProject(tx, actor, projectId)
        const where: Prisma.RealEstateLaunchPhaseWhereInput = { tenantId: actor.tenantId, projectId: project.id, ...(query.q ? { OR: ["name", "code"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {}) }
        const [items, total, editable] = await Promise.all([
          tx.realEstateLaunchPhase.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
          tx.realEstateLaunchPhase.count({ where }),
          tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, "edit"), { id: project.id, archived: false }] }, select: { id: true } }),
        ])
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), projectId: project.id, projectName: project.name, canManage: permits(actor, "projects.edit") && !!editable }
      })
    },
    saveLaunchPhase(projectId: string, input: unknown, id?: string) {
      const { version, ...data } = phaseSchema.parse(input)
      if (id && !version) throw new BusinessError(400, "Refresh the launch phase before saving.")
      return run("projects.edit", async (tx, actor) => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${actor.tenantId} FOR UPDATE`
        await lockTenantOperations(tx, actor.tenantId)
        const project = await rootProject(tx, actor, projectId)
        if (!await tx.realEstateProject.findFirst({ where: { AND: [projectScope(actor, "edit"), { id: project.id, archived: false }] }, select: { id: true } })) throw new BusinessError(403, "Manage launch phases on an active project you can edit.")
        const before = id ? await tx.realEstateLaunchPhase.findFirst({ where: { tenantId: actor.tenantId, projectId: project.id, id } }) : null
        if (id && !before) throw new BusinessError(404, "Launch phase not found.")
        const values = { ...data, opensAt: data.opensAt ? new Date(data.opensAt) : null }
        if (id) {
          const changed = await tx.realEstateLaunchPhase.updateMany({ where: { tenantId: actor.tenantId, projectId: project.id, id, version }, data: { ...values, version: { increment: 1 } } })
          if (!changed.count) throw new BusinessError(409, "This launch phase changed. Refresh before saving.")
        }
        const row = id ? await tx.realEstateLaunchPhase.findUniqueOrThrow({ where: { tenantId_id: { tenantId: actor.tenantId, id } } }) : await tx.realEstateLaunchPhase.create({ data: { tenantId: actor.tenantId, projectId: project.id, ...values } })
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: id ? "realEstate.launchPhase.updated" : "realEstate.launchPhase.created", entityType: "RealEstateProject", entityId: project.id, before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(row)) })
        return row
      })
    },
  }
}

// Catalog hooks operate on a bounded page of already authorized unit IDs.
export async function launchReservationBlocks(tx: Tx, actor: BusinessActor, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>()
  const rows = await tx.$queryRaw<{ itemId: string }[]>`SELECT u."itemId" FROM "RealEstateUnit" u JOIN "RealEstateLaunchPhase" p ON p."tenantId"=u."tenantId" AND p.id=u."launchPhaseId" WHERE u."tenantId"=${actor.tenantId} AND u."itemId"=ANY(${itemIds}::text[]) AND (p.status<>'OPEN' OR p."opensAt">(clock_timestamp() AT TIME ZONE 'UTC'))`
  return new Map(rows.map(row => [row.itemId, "Launch phase is not open for new reservations."]))
}
