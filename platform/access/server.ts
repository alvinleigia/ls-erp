import { externalPermissionAllowed } from "@/platform/collaborators/login"
import type { RecordRules } from "./rules"
import { recordScope } from "./rules"
import type { Resource, PermissionAction } from "./catalog"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { Requirement } from "./catalog"
import { composeProfilePermissions, type ProfileGrant } from "./profiles"

export type PermissionRun = <T>(requirement: Requirement, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) => Promise<T>
// One indexed lookup; aggregate assignments so several profiles never duplicate users.
export async function findAccessUser(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  const [row] = await tx.$queryRaw<{ role: string; collaboratorId: string | null; slug: string; status: string; rules: RecordRules | null; managedTeamIds: string[]; memberTeamIds: string[]; accessAssignments: ProfileGrant[] }[]>`
    SELECT u.role::text, u."collaboratorId", t.slug, t.status::text, p.rules,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('roleId',a."roleId",'role',jsonb_build_object('name',r.name,'moduleKey',r."moduleKey",'archived',r.archived,'permissions',r.permissions)) ORDER BY a."roleId")
        FROM "TenantRoleAssignment" a JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId"
        WHERE a."tenantId"=u."tenantId" AND a."userId"=u.id),'[]'::jsonb) AS "accessAssignments",
      ARRAY(SELECT m."teamId" FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId"
        WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND m."isManager"=true AND team.archived=false) AS "managedTeamIds",
      ARRAY(SELECT m."teamId" FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId"
        WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND team.archived=false) AS "memberTeamIds"
    FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    LEFT JOIN "TenantUserAccess" p ON p."tenantId"=u."tenantId" AND p."userId"=u.id
    WHERE u.id=${userId} AND u."tenantId"=${tenantId} AND u.status='ACTIVE' LIMIT 1`
  return row ? { collaboratorId: row.collaboratorId, recordRules: row.rules ?? {}, managedTeamIds: row.managedTeamIds, memberTeamIds: row.memberTeamIds, role: row.role, tenant: { slug: row.slug, status: row.status }, accessAssignments: row.accessAssignments } : null
}
export function accessContext(user: NonNullable<Awaited<ReturnType<typeof findAccessUser>>>) {
  return { collaboratorId: user.collaboratorId, role: user.role, permissions: assignedPermissions(user), recordRules: user.recordRules, managedTeamIds: user.managedTeamIds, memberTeamIds: user.memberTeamIds }
}
export function assignedPermissions(user: { role: string; collaboratorId?: string | null; recordRules?: RecordRules; accessAssignments?: readonly ProfileGrant[] }) {
  return composeProfilePermissions(user.role, user.accessAssignments ?? [])?.filter(permission => {
    if (user.collaboratorId && !externalPermissionAllowed(permission)) return false
    const [resource, action] = permission.split(".") as [Resource, PermissionAction]
    return recordScope({ role: user.role, tenantId: "", userId: "", recordRules: user.recordRules }, resource, action) !== "NONE"
  })
}
