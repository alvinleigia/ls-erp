import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { officeMembershipSchema, membershipCreationChoicesSchema, initialMembershipChoicesSchema } from "./membership-validation"
export { officeMembershipSchema } from "./membership-validation"
import { loadOfficeMemberships, saveOfficeMemberships, validateOfficeMemberships } from "./office-membership"
import { guardUserWrite } from "@/platform/access/user-security"
import { accessContext, findAccessUser } from "@/platform/access/server"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "@/platform/policy"
import { serializationConflict } from "@/platform/database-errors"
import type { OfficeChoice } from "@/types/companies"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
type Tx = Prisma.TransactionClient
export type { OfficeChoice } from "@/types/companies"
const id = z.string().trim().min(1).max(200)
const selectionSchema = z.object({ version: z.number().int().nonnegative(), officeId: id.nullable() }).strict()
const listSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().trim().max(160).default(""), sort: z.enum(["name", "code"]).default("name"), order: z.enum(["asc", "desc"]).default("asc") }).strict()
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
  const policy = (tx: Tx, userId: string) => loadOfficeMemberships(tx, identity.tenantId, userId)
  async function targetUser(tx: Tx, userId: string) {
    const user = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: userId }, select: { id: true, role: true, status: true } })
    if (!user) throw new BusinessError(404, "User not found.")
    return user
  }
  async function draftCreationChoices(tx: Tx, actor: BusinessActor, target: { role: string; status: string }, query: z.infer<typeof membershipCreationChoicesSchema>) {
    await validateOfficeMemberships(tx, actor.tenantId, target.role, target.status, { officeIds: query.officeIds, companies: query.companies, creationOfficeId: null })
    const grants = JSON.stringify(query.companies)
    const [view] = await tx.$queryRaw<{ items: OfficeChoice[]; total: number; selected: OfficeChoice | null }[]>`
      WITH RECURSIVE covered(id, descendants) AS (
        SELECT c.id,g."includeSubsidiaries" FROM "BusinessCompany" c
        JOIN jsonb_to_recordset(${grants}::jsonb) AS g("companyId" text,"includeSubsidiaries" boolean) ON g."companyId"=c.id
        WHERE c."tenantId"=${actor.tenantId}
        UNION SELECT c.id,true FROM "BusinessCompany" c JOIN covered p ON c."parentId"=p.id AND p.descendants WHERE c."tenantId"=${actor.tenantId}
      ), permitted AS MATERIALIZED (
        SELECT o.id,o.name,o.code,o."companyId",c.name AS "companyName",c.code AS "companyCode"
        FROM "BusinessOffice" o JOIN "BusinessCompany" c ON c.id=o."companyId" AND c."tenantId"=o."tenantId"
        WHERE o."tenantId"=${actor.tenantId} AND NOT o.archived AND NOT c.archived AND ${target.status === "ACTIVE" && hasBusinessAccess(target.role)}
          AND (${target.role === "ADMIN"} OR o.id=ANY(${query.officeIds}::text[]) OR o."companyId" IN (SELECT id FROM covered))
      ), filtered AS (SELECT * FROM permitted WHERE strpos(lower(name),lower(${query.q}))>0 OR strpos(lower(code),lower(${query.q}))>0 OR strpos(lower("companyName"),lower(${query.q}))>0 OR strpos(lower("companyCode"),lower(${query.q}))>0),
      page AS (SELECT * FROM filtered ORDER BY "companyName",name,code,id LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize})
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."companyName",p.name,p.code,p.id) FROM page p),'[]'::jsonb) AS items,
        (SELECT count(*)::integer FROM filtered) AS total,
        (SELECT to_jsonb(p) FROM permitted p WHERE p.id=${query.selected}) AS selected`
    return { ...view, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(view.total/query.pageSize)) }
  }
  return {
    initialCreationChoices(input: unknown) {
      const query = initialMembershipChoicesSchema.parse(input)
      return run(true, (tx, actor) => draftCreationChoices(tx, actor, query, query))
    },
    getMemberships(userId: string) {
      id.parse(userId)
      return run(true, async tx => {
        await targetUser(tx, userId)
        const current = await policy(tx, userId)
        return current ?? { tenantId: identity.tenantId, userId, creationOfficeId: null, creationOffice: null, version: 0, offices: [], companies: [] }
      })
    },
    saveMemberships(userId: string, input: unknown) {
      id.parse(userId)
      const data = officeMembershipSchema.parse(input)
      return run(true, async (tx, actor) => {
        return saveOfficeMemberships(tx, actor, userId, data)
      })
    },
    creationChoices(userId: string, input: unknown) {
      id.parse(userId)
      const query = membershipCreationChoicesSchema.parse(input)
      return run(true, async (tx, actor) => {
        const target = await targetUser(tx, userId)
        return draftCreationChoices(tx, actor, target, query)
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
