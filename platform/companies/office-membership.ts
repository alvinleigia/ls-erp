import { Prisma } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { guardUserWrite } from "@/platform/access/user-security"
import { BusinessError, hasBusinessAccess, type BusinessActor } from "@/platform/policy"
import { officeMembershipSchema, initialOfficeMembershipSchema } from "./membership-validation"
import type { z } from "zod"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
type Tx = Prisma.TransactionClient
const policyInclude = {
  offices: { include: { office: { select: { id: true, name: true, code: true, archived: true } } }, orderBy: { officeId: "asc" } },
  companies: { include: { company: { select: { id: true, name: true, code: true, archived: true } } }, orderBy: { companyId: "asc" } },
} satisfies Prisma.BusinessOfficePolicyInclude


export function loadOfficeMemberships(tx: Tx, tenantId: string, userId: string) {
  return tx.businessOfficePolicy.findUnique({ where: { tenantId_userId: { tenantId, userId } }, include: policyInclude })
}
// Validate proposed memberships before an account exists, then repeat the same
// checks during acceptance/administration under the shared tenant lock.
export async function validateOfficeMemberships(tx: Tx, tenantId: string, role: string, status: string, data: z.infer<typeof initialOfficeMembershipSchema>) {
  if (!hasBusinessAccess(role) && (data.creationOfficeId || data.officeIds.length || data.companies.length)) throw new BusinessError(400, "Choose a business user for office memberships.")
  if (status !== "ACTIVE" && (data.creationOfficeId || data.officeIds.length || data.companies.length)) throw new BusinessError(400, "Activate the user before assigning office memberships.")
  const [offices, companies] = await Promise.all([
    tx.businessOffice.count({ where: { tenantId, id: { in: data.officeIds } } }),
    tx.businessCompany.count({ where: { tenantId, id: { in: data.companies.map(row => row.companyId) } } }),
  ])
  if (offices !== data.officeIds.length || companies !== data.companies.length) throw new BusinessError(400, "Choose offices and companies from this workspace.")
  if (!data.creationOfficeId) return
  const office = await tx.businessOffice.findFirst({ where: { tenantId, id: data.creationOfficeId, archived: false, company: { archived: false } }, select: { companyId: true } })
  if (!office) throw new BusinessError(400, "Choose an active creation office from this workspace.")
  if (role === "ADMIN" || data.officeIds.includes(data.creationOfficeId)) return
  const ancestors = await tx.$queryRaw<{ id: string }[]>`WITH RECURSIVE ancestors AS (
    SELECT id,"parentId" FROM "BusinessCompany" WHERE "tenantId"=${tenantId} AND id=${office.companyId}
    UNION SELECT p.id,p."parentId" FROM "BusinessCompany" p JOIN ancestors a ON p.id=a."parentId" WHERE p."tenantId"=${tenantId}
  ) SELECT id FROM ancestors`
  if (!data.companies.some(grant => grant.companyId === office.companyId || (grant.includeSubsidiaries && ancestors.some(row => row.id === grant.companyId)))) throw new BusinessError(400, "The creation office must be included in this user's effective office memberships.")
}
// Caller owns the transaction: account creation, grants and mandatory audit
// either all commit or all roll back. Version zero is create-only, never upsert.
export async function saveOfficeMemberships(tx: Tx, identity: Identity, userId: string, input: unknown) {
  const data = officeMembershipSchema.parse(input)
  await guardUserWrite(tx, identity)
  await tx.$executeRaw`SELECT set_config('app.actor_id', ${identity.userId}, true)`
  const current = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: identity.userId }, select: { role: true, tenant: { select: { slug: true } } } })
  if (!current || current.tenant?.slug === (process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform")) throw new BusinessError(403, "Office membership access is not permitted.")
  const actor = { ...identity, role: current.role }
  const target = await tx.user.findFirst({ where: { tenantId: identity.tenantId, id: userId }, select: { id: true, role: true, status: true } })
  if (!target) throw new BusinessError(404, "User not found.")
  const before = await loadOfficeMemberships(tx, identity.tenantId, userId)
  if ((before?.version ?? 0) !== data.version) throw new BusinessError(409, "Office memberships changed. Reload before saving.")
  await validateOfficeMemberships(tx, actor.tenantId, target.role, target.status, data)
  const saved = before ? await tx.businessOfficePolicy.update({ where: { tenantId_userId: { tenantId: actor.tenantId, userId }, version: data.version }, data: { creationOfficeId: data.creationOfficeId, version: { increment: 1 } } })
    : await tx.businessOfficePolicy.create({ data: { tenantId: actor.tenantId, userId, creationOfficeId: data.creationOfficeId } })
  await tx.businessOfficeGrant.deleteMany({ where: { tenantId: actor.tenantId, userId } })
  await tx.businessCompanyGrant.deleteMany({ where: { tenantId: actor.tenantId, userId } })
  if (data.officeIds.length) await tx.businessOfficeGrant.createMany({ data: data.officeIds.map(officeId => ({ tenantId: actor.tenantId, userId, officeId })) })
  if (data.companies.length) await tx.businessCompanyGrant.createMany({ data: data.companies.map(row => ({ tenantId: actor.tenantId, userId, ...row })) })
  if (data.creationOfficeId && !(await tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.business_office_allowed(${actor.tenantId},${data.creationOfficeId},${userId}) AS allowed`)[0]?.allowed) throw new BusinessError(400, "The creation office must be included in this user's effective office memberships.")
  const snapshot = (row: typeof before): Prisma.InputJsonValue | undefined => row ? { creationOfficeId: row.creationOfficeId, version: row.version, officeIds: row.offices.map(g => g.officeId), companies: row.companies.map(g => ({ companyId: g.companyId, includeSubsidiaries: g.includeSubsidiaries })) } : undefined
  await recordDomainAuditEvent(tx, { ...identity, actorUserId: actor.userId, actorRole: actor.role, event: "structure.officeMembership.updated", entityType: "BusinessOfficePolicy", entityId: userId, before: snapshot(before), after: { ...data, version: saved.version } })
  return (await loadOfficeMemberships(tx, identity.tenantId, userId))!
}
