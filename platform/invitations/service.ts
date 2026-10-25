import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { Prisma, type PrismaClient } from "@prisma/client"
import { recordDomainAuditEvent } from "@/lib/domain-audit"
import { runWithDatabaseActor } from "@/lib/database-actor"
import { BusinessError, type BusinessActor } from "@/platform/policy"
import { guardUserWrite, assignInitialProfiles, auditUserSecurity, validateInitialProfiles } from "@/platform/access/user-security"
import { saveOfficeMemberships, validateOfficeMemberships } from "@/platform/companies/office-membership"
import { acceptInviteSchema, invitationAccessSchema, inviteUserSchema } from "./validation"

type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
type Tx = Prisma.TransactionClient
const platformSlug = () => process.env.PLATFORM_ADMIN_TENANT_SLUG?.trim().toLowerCase() || "platform"
const invalid = () => new BusinessError(400, "Invitation is invalid or expired. Ask your administrator for a new invitation.")

async function admin(tx: Tx, identity: Identity) {
  await guardUserWrite(tx, identity)
  const tenant = await tx.tenant.findFirst({ where: { id: identity.tenantId, status: "ACTIVE", slug: { not: platformSlug() } }, select: { id: true } })
  if (!tenant) throw new BusinessError(403, "Invitation administration is not permitted.")
  await tx.$executeRaw`SELECT set_config('app.actor_id', ${identity.userId}, true)`
}
async function validateAccess(tx: Tx, tenantId: string, role: string, access: ReturnType<typeof invitationAccessSchema.parse>) {
  await validateInitialProfiles(tx, tenantId, role, access.accessRoleIds)
  if (access.officeAccess) await validateOfficeMemberships(tx, tenantId, role, "ACTIVE", access.officeAccess)
}
async function existingAccount(tx: Tx, tenantId: string, email: string) {
  if (await tx.user.count({ where: { tenantId, email: { equals: email, mode: "insensitive" } } })) throw new BusinessError(409, "An account already exists for this email. Use account management or password reset.")
}
const auditSnapshot = (invite: { email: string; role: string; expiresAt: Date; accessConfiguration: Prisma.JsonValue }) => ({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt.toISOString(), accessConfiguration: invite.accessConfiguration })

export function createInvitationService(db: PrismaClient, identity: Identity) {
  return {
    create(input: unknown) {
      const { email, role, delivery: _delivery, ...access } = inviteUserSchema.parse(input)
      void _delivery
      return db.$transaction(async tx => {
        await admin(tx, identity)
        await existingAccount(tx, identity.tenantId, email)
        if (await tx.invitation.count({ where: { tenantId: identity.tenantId, email: { equals: email, mode: "insensitive" }, acceptedAt: null, expiresAt: { gt: new Date() } } })) throw new BusinessError(409, "A pending invitation already exists. Copy its link or revoke it before inviting again.")
        await validateAccess(tx, identity.tenantId, role, access)
        const invite = await tx.invitation.create({ data: { tenantId: identity.tenantId, invitedById: identity.userId, email, role, token: randomUUID(), expiresAt: new Date(Date.now() + 7 * 86400000), accessConfiguration: access as Prisma.InputJsonObject } })
        await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event: "core.invitations.create", entityType: "Invitation", entityId: invite.id, after: auditSnapshot(invite) })
        return invite
      })
    },
    revoke(id: string) {
      return db.$transaction(async tx => {
        await admin(tx, identity)
        const before = await tx.invitation.findFirst({ where: { id, tenantId: identity.tenantId } })
        if (!before) throw new BusinessError(404, "Invitation not found.")
        if (before.acceptedAt) throw new BusinessError(409, "This invitation was accepted. Manage the user account instead.")
        const result = await tx.invitation.deleteMany({ where: { id, tenantId: identity.tenantId, acceptedAt: null } })
        if (result.count !== 1) throw new BusinessError(409, "Invitation changed. Reload before trying again.")
        await recordDomainAuditEvent(tx, { ...identity, actorUserId: identity.userId, actorRole: "ADMIN", event: "core.invitations.archive", entityType: "Invitation", entityId: id, before: auditSnapshot(before), after: { deleted: true } })
        return { ok: true }
      })
    },
  }
}

// The exact token is a one-use onboarding capability, not a login session or an
// instruction to modify an existing account. No RLS bypass is used here.
export async function acceptInvitation(db: PrismaClient, tenantId: string, input: unknown, requestId?: string) {
  const data = acceptInviteSchema.parse(input)
  const passwordHash = await bcrypt.hash(data.password, 10)
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId} FOR UPDATE`
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId, status: "ACTIVE", slug: { not: platformSlug() } }, select: { id: true } })
    if (!tenant) throw invalid()
    const [context] = await tx.$queryRaw<{ id: string; invitedById: string }[]>`SELECT * FROM app.invitation_accept_context(${tenantId},${data.token})`
    if (!context) throw invalid()
    const identity = { tenantId, userId: context.invitedById, requestId }
    return runWithDatabaseActor(identity.userId, async () => {
      await tx.$executeRaw`SELECT set_config('app.actor_id', ${identity.userId}, true)`
      await admin(tx, identity)
      const invite = await tx.invitation.findFirst({ where: { id: context.id, tenantId, token: data.token, acceptedAt: null, expiresAt: { gt: new Date() } } })
      if (!invite) throw invalid()
      await existingAccount(tx, tenantId, invite.email)
      const access = invitationAccessSchema.parse(invite.accessConfiguration)
      await validateAccess(tx, tenantId, invite.role, access)
      const consumed = await tx.invitation.updateMany({ where: { id: invite.id, tenantId, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } })
      if (consumed.count !== 1) throw invalid()
      const user = await tx.user.create({ data: { tenantId, name: data.name || undefined, email: invite.email.toLowerCase(), passwordHash, role: invite.role, status: "ACTIVE" }, select: { id: true, role: true, status: true } })
      await assignInitialProfiles(tx, identity, user, access.accessRoleIds, access.recordRules)
      if (access.officeAccess) await saveOfficeMemberships(tx, identity, user.id, { ...access.officeAccess, version: 0 })
      await auditUserSecurity(tx, identity, user.id, null, user)
      await recordDomainAuditEvent(tx, { tenantId, actorUserId: user.id, actorRole: user.role, requestId, event: "core.invitations.accept", entityType: "Invitation", entityId: invite.id, after: { userId: user.id, role: user.role }, metadata: { invitedById: identity.userId } })
      return { ok: true }
    })
  })
}
