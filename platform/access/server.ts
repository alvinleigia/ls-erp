import type { RecordScope } from "./record-scope"
import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { Permission, Requirement } from "./catalog"

export type PermissionRun = <T>(requirement: Requirement, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) => Promise<T>
// One indexed lookup per operation, independent of the number of result rows.
export async function findAccessUser(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  const [row] = await tx.$queryRaw<{ role: string; slug: string; status: string; roleId: string | null; archived: boolean | null; permissions: string[] | null; salesRecordScope: RecordScope | null; projectRecordScope: RecordScope | null; managedTeamIds: string[]; memberTeamIds: string[] }[]>`
    SELECT u.role::text, t.slug, t.status::text, a."roleId", r.archived, r.permissions, r."salesRecordScope", r."projectRecordScope",
      ARRAY(SELECT m."teamId" FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId"
        WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND m."isManager"=true AND team.archived=false
          AND u.role='MANAGER') AS "managedTeamIds",
      ARRAY(SELECT m."teamId" FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId"
        WHERE m."tenantId"=u."tenantId" AND m."userId"=u.id AND team.archived=false) AS "memberTeamIds"
    FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    LEFT JOIN "TenantRoleAssignment" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
    LEFT JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId"
    WHERE u.id=${userId} AND u."tenantId"=${tenantId} AND u.status='ACTIVE' LIMIT 1`
  return row ? { salesRecordScope: row.salesRecordScope ?? "ACCOUNT_ROLE", projectRecordScope: row.projectRecordScope ?? "ACCOUNT_ROLE", managedTeamIds: row.managedTeamIds, memberTeamIds: row.memberTeamIds, role: row.role, tenant: { slug: row.slug, status: row.status }, accessAssignment: row.roleId ? { role: { archived: row.archived ?? true, permissions: row.permissions || [] } } : null } : null
}
// Keep every transaction's freshly resolved permissions and scope context together.
export function accessContext(user: NonNullable<Awaited<ReturnType<typeof findAccessUser>>>) {
  return { role: user.role, permissions: assignedPermissions(user), salesRecordScope: user.salesRecordScope, projectRecordScope: user.projectRecordScope, managedTeamIds: user.managedTeamIds, memberTeamIds: user.memberTeamIds }
}
export function assignedPermissions(user: { role: string; accessAssignment?: { role: { archived: boolean; permissions: string[] } } | null }): Permission[] | undefined {
  if (user.role === "ADMIN" || !user.accessAssignment) return undefined
  return user.accessAssignment.role.archived ? [] : user.accessAssignment.role.permissions as Permission[]
}
