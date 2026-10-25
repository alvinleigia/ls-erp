import type { Prisma } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { BusinessError, type BusinessActor } from "@/platform/policy"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">

// Only for a newly provisioned tenant, inside its platform creation transaction.
// Never repairs an existing user's policy or chooses an office at request time.
export async function provisionTenantAdminOffice(tx: Prisma.TransactionClient, identity: Identity, tenantId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${identity.tenantId} FOR UPDATE`
  const platformSlug = process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
  const caller = await tx.user.findFirst({ where: { id: identity.userId, tenantId: identity.tenantId, status: "ACTIVE", tenant: { slug: platformSlug, status: "ACTIVE" } }, select: { role: true } })
  const target = await tx.tenant.findFirst({ where: { id: tenantId, status: "ACTIVE", slug: { not: platformSlug } }, select: { organizationId: true } })
  if (!caller || !target || (caller.role !== "ADMIN" && (!target.organizationId || !await tx.organizationMembership.count({ where: { userId: identity.userId, organizationId: target.organizationId } })))) throw new BusinessError(403, "Tenant provisioning access is not permitted.")
  if (!await tx.user.count({ where: { id: userId, tenantId, role: "ADMIN", status: "ACTIVE" } })) throw new BusinessError(400, "Choose the new tenant administrator.")
  const office = await tx.businessOffice.findFirst({ where: { tenantId, isInitial: true, archived: false, company: { isInitial: true, archived: false } }, select: { id: true } })
  if (!office) throw new BusinessError(409, "The new tenant's initial office is missing.")
  if (await tx.businessOfficePolicy.count({ where: { tenantId, userId } })) throw new BusinessError(409, "Office memberships already exist. Use membership administration.")
  const policy = await tx.businessOfficePolicy.create({ data: { tenantId, userId, creationOfficeId: office.id } })
  await tx.businessOfficeGrant.create({ data: { tenantId, userId, officeId: office.id } })
  await recordDomainAuditEvent(tx, { tenantId, actorUserId: identity.userId, actorRole: caller.role, requestId: identity.requestId,
    event: "structure.officeMembership.updated", entityType: "BusinessOfficePolicy", entityId: userId,
    metadata: { platformTenantId: identity.tenantId, reason: "tenant.provisioned" },
    after: { creationOfficeId: office.id, version: policy.version, officeIds: [office.id], companies: [] } })
  return policy
}
