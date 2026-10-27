import { Prisma, type PrismaClient } from "@prisma/client"
import { guardUserWrite } from "@/platform/access/user-security"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { collaboratorCreateSchema, collaboratorUpdateSchema, collaboratorQuerySchema, supervisorQuerySchema } from "./contracts"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
const supervisorSelect = { id: true, name: true, email: true, role: true, status: true } satisfies Prisma.UserSelect
const select = { id: true, code: true, name: true, classification: true, organizationName: true, email: true, phone: true, supervisorUserId: true, archived: true, version: true, supervisor: { select: supervisorSelect } } satisfies Prisma.ExternalCollaboratorSelect
// Administration of external identities never grants business or workforce access.
export function createCollaboratorService(db: PrismaClient, identity: Identity) {
  async function run<T>(write: boolean, work: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    try {
      return await db.$transaction(async tx => {
        if (write) await guardUserWrite(tx, identity)
        const actor = await authorizeBusinessOperation(tx, identity, "users.read")
        if (actor.role !== "ADMIN") throw new BusinessError(403, "Tenant administrator access is required.")
        return work(tx, actor)
      })
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new BusinessError(409, "This collaborator code is already in use.")
      throw error
    }
  }
  async function get(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.externalCollaborator.findFirst({ where: { tenantId: identity.tenantId, id }, select })
    if (!row) throw new BusinessError(404, "Collaborator not found.")
    return row
  }
  async function supervisor(tx: Prisma.TransactionClient, userId: string) {
    if (!await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: userId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER"] } }, select: { id: true } })) throw new BusinessError(400, "Choose an active internal administrator or manager in this workspace.")
  }
  const audit = (tx: Prisma.TransactionClient, actor: BusinessActor, id: string, before: unknown, after: unknown) => recordDomainAuditEvent(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: `collaborator.${before ? "updated" : "created"}`, entityType: "ExternalCollaborator", entityId: id,
    ...(before ? { before: before as Prisma.InputJsonValue } : {}), after: after as Prisma.InputJsonValue,
  })
  return {
    list(input: unknown) {
      const query = collaboratorQuerySchema.parse(input)
      return run(false, async tx => {
        const where: Prisma.ExternalCollaboratorWhereInput = { tenantId: identity.tenantId,
          ...(query.status === "all" ? {} : { archived: query.status === "archived" }),
          ...(query.q ? { OR: ["name", "code", "classification", "organizationName", "email"].map(field => ({ [field]: { contains: query.q, mode: "insensitive" } })) } : {}) }
        const total = await tx.externalCollaborator.count({ where })
        const items = await tx.externalCollaborator.findMany({ where, select, orderBy: [{ [query.sort]: query.order }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
      })
    },
    get(id: string) { return run(false, tx => get(tx, id)) },
    create(input: unknown) {
      const data = collaboratorCreateSchema.parse(input)
      return run(true, async (tx, actor) => {
        await supervisor(tx, data.supervisorUserId)
        const row = await tx.externalCollaborator.create({ data: { ...data, tenantId: identity.tenantId }, select })
        await audit(tx, actor, row.id, null, row)
        return row
      })
    },
    update(id: string, input: unknown) {
      const { version, ...data } = collaboratorUpdateSchema.parse(input)
      return run(true, async (tx, actor) => {
        const before = await get(tx, id)
        if (before.version !== version) throw new BusinessError(409, "Collaborator changed. Reload before saving.")
        // Keep inactive supervisors as history; require current eligibility for a
        // changed assignment or restoring an archived collaborator.
        if ((data.supervisorUserId && data.supervisorUserId !== before.supervisorUserId) || (before.archived && data.archived === false)) await supervisor(tx, data.supervisorUserId ?? before.supervisorUserId)
        const row = await tx.externalCollaborator.update({ where: { tenantId_id: { tenantId: identity.tenantId, id }, version }, data: { ...data, version: { increment: 1 } }, select })
        await audit(tx, actor, id, before, row)
        return row
      })
    },
    logins(id: string, input: unknown) {
      const query = supervisorQuerySchema.parse(input)
      return run(false, async tx => {
        await get(tx, id)
        const where: Prisma.UserWhereInput = { tenantId: identity.tenantId, collaboratorId: id,
          ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] } : {}) }
        const total = await tx.user.count({ where })
        const items = await tx.user.findMany({ where, select: { id: true, name: true, email: true, role: true, status: true, collaboratorId: true }, orderBy: [{ email: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
        return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
      })
    },
    supervisors(input: unknown) {
      const query = supervisorQuerySchema.parse(input)
      return run(false, async tx => {
        const where: Prisma.UserWhereInput = { tenantId: identity.tenantId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER"] },
          ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] } : {}) }
        const total = await tx.user.count({ where })
        const items = await tx.user.findMany({ where, select: supervisorSelect, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
        return { items: items.map(user => ({ ...user, name: user.name || user.email })), total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
      })
    },
  }
}
