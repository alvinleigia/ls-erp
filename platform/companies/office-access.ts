import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { guardUserWrite } from "@/platform/access/user-security"
import { accessContext, findAccessUser } from "@/platform/access/server"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "@/platform/policy"
import { serializationConflict } from "@/platform/database-errors"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
type Tx = Prisma.TransactionClient
export type OfficeChoice = { id: string; code: string; name: string; companyId: string; companyCode: string; companyName: string }
const id = z.string().trim().min(1).max(200)
export const officeMembershipSchema = z.object({
  version: z.number().int().nonnegative(), creationOfficeId: id.nullable(),
  officeIds: z.array(id).max(200),
  companies: z.array(z.object({ companyId: id, includeSubsidiaries: z.boolean() }).strict()).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.officeIds).size !== value.officeIds.length) ctx.addIssue({ code: "custom", path: ["officeIds"], message: "Choose each office only once." })
  if (new Set(value.companies.map(row => row.companyId)).size !== value.companies.length) ctx.addIssue({ code: "custom", path: ["companies"], message: "Choose each company only once." })
})
const selectionSchema = z.object({ version: z.number().int().nonnegative(), officeId: id.nullable() }).strict()
const listSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().trim().max(160).default(""), sort: z.enum(["name", "code"]).default("name"), order: z.enum(["asc", "desc"]).default("asc") }).strict()
const policyInclude = {
  offices: { include: { office: { select: { id: true, name: true, code: true, archived: true } } }, orderBy: { officeId: "asc" } },
  companies: { include: { company: { select: { id: true, name: true, code: true, archived: true } } }, orderBy: { companyId: "asc" } },
} satisfies Prisma.BusinessOfficePolicyInclude

// These checks grant no profile action or record access by themselves. Native
// record policies must intersect office eligibility with their own source rules.
export async function officeAccessible(tx: Tx, actor: Pick<BusinessActor, "tenantId" | "userId">, officeId: string, userId = actor.userId) {
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.business_office_access(${actor.tenantId},${officeId},${userId}) AS allowed`
  return row?.allowed === true
}
// Creation choices exclude closed offices; historical eligibility above retains
// explicit grants until an administrator revokes them.
export async function officeAllowed(tx: Tx, actor: Pick<BusinessActor, "tenantId" | "userId">, officeId: string, userId = actor.userId) {
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.business_office_allowed(${actor.tenantId},${officeId},${userId}) AS allowed`
  return row?.allowed === true
}
export function createOfficeAccessService(db: PrismaClient, identity: Identity) {
  async function run<T>(administrative: boolean, operation: (tx: Tx, actor: BusinessActor) => Promise<T>) {
    try { return await db.$transaction(async tx => {
      if (administrative) await guardUserWrite(tx, identity)
      await tx.$executeRaw`SELECT set_config('app.actor_id', ${identity.userId}, true)`
      const user = await findAccessUser(tx, identity.tenantId, identity.userId)
      if (!user || !hasBusinessAccess(user.role) || user.tenant.status !== "ACTIVE" || user.tenant.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform") || (administrative && user.role !== "ADMIN")) throw new BusinessError(403, "Office membership access is not permitted.")
      return operation(tx, { ...identity, ...accessContext(user) })
    }) } catch (error) {
      if (serializationConflict(error)) throw new BusinessError(409, "Office settings changed. Reload before saving.")
      const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } }
      if (value.code === "P2010" && (value.meta?.code === "42501" || value.meta?.driverAdapterError?.cause?.originalCode === "42501")) throw new BusinessError(403, "Office membership access is not permitted.")
      throw error
    }
  }
  const policy = (tx: Tx, userId: string) => tx.businessOfficePolicy.findUnique({ where: { tenantId_userId: { tenantId: identity.tenantId, userId } }, include: policyInclude })
  async function targetUser(tx: Tx, userId: string) {
    const user = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: userId }, select: { id: true, role: true, status: true } })
    if (!user) throw new BusinessError(404, "User not found.")
    return user
  }
  return {
    getMemberships(userId: string) {
      id.parse(userId)
      return run(true, async tx => {
        await targetUser(tx, userId)
        const current = await policy(tx, userId)
        return current ?? { tenantId: identity.tenantId, userId, creationOfficeId: null, version: 0, offices: [], companies: [] }
      })
    },
    saveMemberships(userId: string, input: unknown) {
      id.parse(userId)
      const data = officeMembershipSchema.parse(input)
      return run(true, async (tx, actor) => {
        const target = await targetUser(tx, userId)
        if (!hasBusinessAccess(target.role) && (data.creationOfficeId || data.officeIds.length || data.companies.length)) throw new BusinessError(400, "Choose a business user for office memberships.")
        if (target.status !== "ACTIVE" && (data.creationOfficeId || data.officeIds.length || data.companies.length)) throw new BusinessError(400, "Activate the user before assigning office memberships.")
        const before = await policy(tx, userId)
        if ((before?.version ?? 0) !== data.version) throw new BusinessError(409, "Office memberships changed. Reload before saving.")
        const [offices, companies] = await Promise.all([
          tx.businessOffice.count({ where: { tenantId: actor.tenantId, id: { in: data.officeIds } } }),
          tx.businessCompany.count({ where: { tenantId: actor.tenantId, id: { in: data.companies.map(row => row.companyId) } } }),
        ])
        if (offices !== data.officeIds.length || companies !== data.companies.length) throw new BusinessError(400, "Choose offices and companies from this workspace.")
        if (data.creationOfficeId && !await tx.businessOffice.count({ where: { tenantId: actor.tenantId, id: data.creationOfficeId, archived: false, company: { archived: false } } })) throw new BusinessError(400, "Choose an active creation office from this workspace.")
        const saved = before ? await tx.businessOfficePolicy.update({ where: { tenantId_userId: { tenantId: actor.tenantId, userId }, version: data.version }, data: { creationOfficeId: data.creationOfficeId, version: { increment: 1 } } })
          : await tx.businessOfficePolicy.create({ data: { tenantId: actor.tenantId, userId, creationOfficeId: data.creationOfficeId } })
        await tx.businessOfficeGrant.deleteMany({ where: { tenantId: actor.tenantId, userId } })
        await tx.businessCompanyGrant.deleteMany({ where: { tenantId: actor.tenantId, userId } })
        if (data.officeIds.length) await tx.businessOfficeGrant.createMany({ data: data.officeIds.map(officeId => ({ tenantId: actor.tenantId, userId, officeId })) })
        if (data.companies.length) await tx.businessCompanyGrant.createMany({ data: data.companies.map(row => ({ tenantId: actor.tenantId, userId, ...row })) })
        if (data.creationOfficeId && !await officeAllowed(tx, actor, data.creationOfficeId, userId)) throw new BusinessError(400, "The creation office must be included in this user's effective office memberships.")
        const snapshot = (row: typeof before): Prisma.InputJsonValue | undefined => row ? { creationOfficeId: row.creationOfficeId, version: row.version, officeIds: row.offices.map(g => g.officeId), companies: row.companies.map(g => ({ companyId: g.companyId, includeSubsidiaries: g.includeSubsidiaries })) } : undefined
        await recordDomainAuditEvent(tx, { ...identity, actorUserId: actor.userId, actorRole: actor.role, event: "structure.officeMembership.updated", entityType: "BusinessOfficePolicy", entityId: userId, before: snapshot(before), after: { ...data, version: saved.version } })
        return (await policy(tx, userId))!
      })
    },
    listOwnOffices(input: unknown) {
      const query = listSchema.parse(input)
      return run(false, async (tx, actor) => {
        const sort = Prisma.raw(query.sort), pageSort = Prisma.raw(`p.${query.sort}`), direction = Prisma.raw(query.order)
        const [result] = await tx.$queryRaw<{ items: OfficeChoice[]; total: number }[]>`WITH permitted AS MATERIALIZED (
          SELECT * FROM app.business_office_choices(${actor.tenantId},${actor.userId})
          WHERE strpos(lower(name),lower(${query.q}))>0 OR strpos(lower(code),lower(${query.q}))>0 OR strpos(lower("companyName"),lower(${query.q}))>0
        ), page AS (SELECT * FROM permitted ORDER BY ${sort} ${direction},id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize})
        SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY ${pageSort} ${direction},p.id) FROM page p),'[]'::jsonb) AS items,(SELECT count(*)::integer FROM permitted) AS total`
        return { ...result, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)) }
      })
    },
    getOwnContext() {
      return run(false, async (tx, actor) => {
        const current = await tx.businessOfficePolicy.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } } })
        const choices = current?.creationOfficeId ? await tx.$queryRaw<OfficeChoice[]>`SELECT * FROM app.business_office_choices(${actor.tenantId},${actor.userId}) WHERE id=${current.creationOfficeId}` : []
        return { creationOffice: choices[0] ?? null, version: current?.version ?? 0 }
      })
    },
    selectCreationOffice(input: unknown) {
      const data = selectionSchema.parse(input)
      return run(false, async (tx, actor) => {
        // Same lock as grant edits, hierarchy changes and account revocation.
        await guardUserWrite(tx, identity, actor.userId, undefined, false)
        const current = await tx.businessOfficePolicy.findUnique({ where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } } })
        if ((current?.version ?? 0) !== data.version) throw new BusinessError(409, "Office preference changed. Reload before saving.")
        if (data.officeId && !await officeAllowed(tx, actor, data.officeId)) throw new BusinessError(403, "Choose an accessible active office.")
        const [row] = await tx.$queryRaw<{ version: number }[]>`SELECT app.select_creation_office(${actor.tenantId},${data.officeId},${data.version}::integer,${actor.requestId ?? null}) AS version`
        return { creationOfficeId: data.officeId, version: row.version }
      })
    },
  }
}
