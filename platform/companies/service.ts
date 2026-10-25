import { Prisma, type PrismaClient } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { authorizeBusinessOperation } from "@/platform/access/operation"
import { guardUserWrite } from "@/platform/access/user-security"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { companyCreateSchema, companyUpdateSchema, officeCreateSchema, officeUpdateSchema, structureQuerySchema } from "./contracts"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
const companySelect = { id: true, code: true, name: true, parentId: true, isInitial: true, archived: true, version: true, parent: { select: { id: true, code: true, name: true } } } satisfies Prisma.BusinessCompanySelect
const officeSelect = { id: true, code: true, name: true, companyId: true, isInitial: true, archived: true, version: true, company: { select: { id: true, code: true, name: true } } } satisfies Prisma.BusinessOfficeSelect

// Directory administration only. Office membership and native record scope are
// separate layers; directory placement never grants business-record access.
export function createCompanyService(db: PrismaClient, identity: Identity) {
  async function run<T>(write: boolean, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) {
    try {
      return await db.$transaction(async tx => {
        if (write) await guardUserWrite(tx, identity)
        const actor = await authorizeBusinessOperation(tx, identity, "businessSettings.read")
        if (actor.role !== "ADMIN") throw new BusinessError(403, "Tenant administrator access is required.")
        return operation(tx, actor)
      })
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new BusinessError(409, "This code is already in use. Choose a different code.")
      throw error
    }
  }
  const audit = (tx: Prisma.TransactionClient, actor: BusinessActor, kind: "company" | "office", id: string, before: unknown, after: unknown) => recordDomainAuditEvent(tx, {
    tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId,
    event: `structure.${kind}.${before ? "updated" : "created"}`, entityType: kind === "company" ? "BusinessCompany" : "BusinessOffice", entityId: id,
    ...(before ? { before: before as Prisma.InputJsonValue } : {}), after: after as Prisma.InputJsonValue,
  })
  async function activeCompany(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.businessCompany.findFirst({ where: { tenantId: identity.tenantId, id, archived: false }, select: { id: true } })
    if (!row) throw new BusinessError(400, "Choose an active company in this workspace.")
  }
  async function company(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.businessCompany.findFirst({ where: { tenantId: identity.tenantId, id }, select: companySelect })
    if (!row) throw new BusinessError(404, "Company not found.")
    return row
  }
  async function office(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.businessOffice.findFirst({ where: { tenantId: identity.tenantId, id }, select: officeSelect })
    if (!row) throw new BusinessError(404, "Office not found.")
    return row
  }
  return {
    listCompanies(input: unknown) {
      const query = structureQuerySchema.omit({ companyId: true }).parse(input)
      return run(false, async tx => {
        const where = { tenantId: identity.tenantId, ...(query.status === "all" ? {} : { archived: query.status === "archived" }),
          ...(query.q ? { OR: [{ name: { contains: query.q, mode: Prisma.QueryMode.insensitive } }, { code: { contains: query.q, mode: Prisma.QueryMode.insensitive } }] } : {}) }
        const total = await tx.businessCompany.count({ where })
        const items = await tx.businessCompany.findMany({ where, select: companySelect, orderBy: [{ isInitial: "desc" }, { [query.sort]: query.order }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
        return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
      })
    },
    getCompany(id: string) { return run(false, tx => company(tx, id)) },
    createCompany(input: unknown) {
      const data = companyCreateSchema.parse(input)
      return run(true, async (tx, actor) => {
        if (data.parentId) await activeCompany(tx, data.parentId)
        const row = await tx.businessCompany.create({ data: { ...data, tenantId: actor.tenantId }, select: companySelect })
        await audit(tx, actor, "company", row.id, null, row)
        return row
      })
    },
    updateCompany(id: string, input: unknown) {
      const { version, ...data } = companyUpdateSchema.parse(input)
      return run(true, async (tx, actor) => {
        const before = await company(tx, id)
        if (before.version !== version) throw new BusinessError(409, "Company changed. Reload before saving.")
        const next = { ...before, ...data }
        if (next.isInitial && next.archived) throw new BusinessError(409, "Keep the initial company active.")
        if (next.parentId) {
          await activeCompany(tx, next.parentId)
          const [result] = await tx.$queryRaw<{ cycle: boolean }[]>`WITH RECURSIVE ancestors AS (
            SELECT id,"parentId" FROM "BusinessCompany" WHERE "tenantId"=${actor.tenantId} AND id=${next.parentId}
            UNION SELECT p.id,p."parentId" FROM "BusinessCompany" p JOIN ancestors a ON p.id=a."parentId" WHERE p."tenantId"=${actor.tenantId}
          ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=${id}) AS cycle`
          if (result.cycle) throw new BusinessError(409, "A company cannot be its own ancestor. Choose a different parent.")
        }
        if (next.archived && (await tx.businessCompany.count({ where: { tenantId: actor.tenantId, parentId: id, archived: false } }) || await tx.businessOffice.count({ where: { tenantId: actor.tenantId, companyId: id, archived: false } }))) throw new BusinessError(409, "Archive active subsidiaries and offices first.")
        const row = await tx.businessCompany.update({ where: { tenantId_id: { tenantId: actor.tenantId, id }, version }, data: { ...data, version: { increment: 1 } }, select: companySelect })
        await audit(tx, actor, "company", id, before, row)
        return row
      })
    },
    listOffices(input: unknown) {
      const query = structureQuerySchema.parse(input)
      return run(false, async tx => {
        if (query.companyId) await company(tx, query.companyId)
        const where = { tenantId: identity.tenantId, ...(query.companyId ? { companyId: query.companyId } : {}), ...(query.status === "all" ? {} : { archived: query.status === "archived" }),
          ...(query.q ? { OR: [{ name: { contains: query.q, mode: Prisma.QueryMode.insensitive } }, { code: { contains: query.q, mode: Prisma.QueryMode.insensitive } }] } : {}) }
        const total = await tx.businessOffice.count({ where })
        const items = await tx.businessOffice.findMany({ where, select: officeSelect, orderBy: [{ isInitial: "desc" }, { [query.sort]: query.order }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })
        return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
      })
    },
    getOffice(id: string) { return run(false, tx => office(tx, id)) },
    createOffice(input: unknown) {
      const data = officeCreateSchema.parse(input)
      return run(true, async (tx, actor) => {
        await activeCompany(tx, data.companyId)
        const row = await tx.businessOffice.create({ data: { ...data, tenantId: actor.tenantId }, select: officeSelect })
        await audit(tx, actor, "office", row.id, null, row)
        return row
      })
    },
    updateOffice(id: string, input: unknown) {
      const { version, ...data } = officeUpdateSchema.parse(input)
      return run(true, async (tx, actor) => {
        const before = await office(tx, id)
        if (before.version !== version) throw new BusinessError(409, "Office changed. Reload before saving.")
        if (before.isInitial && data.archived) throw new BusinessError(409, "Keep the initial office active.")
        if (!(data.archived ?? before.archived)) await activeCompany(tx, before.companyId)
        const row = await tx.businessOffice.update({ where: { tenantId_id: { tenantId: actor.tenantId, id }, version }, data: { ...data, version: { increment: 1 } }, select: officeSelect })
        await audit(tx, actor, "office", id, before, row)
        return row
      })
    },
  }
}
