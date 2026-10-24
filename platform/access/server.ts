import type { RecordScope } from "./record-scope"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { Requirement } from "./catalog"
import { composeProfilePermissions, type ProfileGrant } from "./profiles"

export type PermissionRun = <T>(requirement: Requirement, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) => Promise<T>
// One indexed lookup; aggregate assignments so several profiles never duplicate users.
export async function findAccessUser(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  const [row] = await tx.$queryRaw<{ role: string; slug: string; status: string; salesRecordScope: RecordScope | null; projectRecordScope: RecordScope | null; managedTeamIds: string[]; memberTeamIds: string[]; accessAssignments: ProfileGrant[] }[]>`
    SELECT u.role::text, t.slug, t.status::text, p."salesRecordScope", p."projectRecordScope",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('roleId',a."roleId",'role',jsonb_build_object('name',r.name,'moduleKey',r."moduleKey",'archived',r.archived,'permissions',r.permissions)) ORDER BY a."roleId")
        FROM "TenantRoleAssignment" a JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId"
        WHERE a."tenantId"=u."tenantId" AND a."userId"=u.id),'[]'::jsonb) AS "accessAssignments",
      ARRAY(SELECT m."teamId" FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId"
        WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND m."isManager"=true AND team.archived=false AND u.role='MANAGER') AS "managedTeamIds",
      ARRAY(SELECT m."teamId" FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId"
        WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND team.archived=false) AS "memberTeamIds"
    FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    LEFT JOIN "TenantUserAccess" p ON p."tenantId"=u."tenantId" AND p."userId"=u.id
    WHERE u.id=${userId} AND u."tenantId"=${tenantId} AND u.status='ACTIVE' LIMIT 1`
  return row ? { salesRecordScope: row.salesRecordScope ?? "OWN", projectRecordScope: row.projectRecordScope ?? "OWN", managedTeamIds: row.managedTeamIds, memberTeamIds: row.memberTeamIds, role: row.role, tenant: { slug: row.slug, status: row.status }, accessAssignments: row.accessAssignments } : null
}
export function accessContext(user: NonNullable<Awaited<ReturnType<typeof findAccessUser>>>) {
  return { role: user.role, permissions: assignedPermissions(user), salesRecordScope: user.salesRecordScope, projectRecordScope: user.projectRecordScope, managedTeamIds: user.managedTeamIds, memberTeamIds: user.memberTeamIds }
}
export function assignedPermissions(user: { role: string; accessAssignments?: readonly ProfileGrant[] }) {
  return composeProfilePermissions(user.role, user.accessAssignments ?? [])
}
