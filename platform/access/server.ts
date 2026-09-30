import type { Prisma } from "@prisma/client"
import type { BusinessActor } from "../policy"
import type { Permission, Requirement } from "./catalog"

export type PermissionRun = <T>(requirement: Requirement, operation: (tx: Prisma.TransactionClient, actor: BusinessActor) => Promise<T>) => Promise<T>
// One indexed lookup per operation, independent of the number of result rows.
export async function findAccessUser(tx: Prisma.TransactionClient, tenantId: string, userId: string) {
  const [row] = await tx.$queryRaw<{ role: string; slug: string; status: string; roleId: string | null; archived: boolean | null; permissions: string[] | null }[]>`
    SELECT u.role::text, t.slug, t.status::text, a."roleId", r.archived, r.permissions
    FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    LEFT JOIN "TenantRoleAssignment" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
    LEFT JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId"
    WHERE u.id=${userId} AND u."tenantId"=${tenantId} AND u.status='ACTIVE' LIMIT 1`
  return row ? { role: row.role, tenant: { slug: row.slug, status: row.status }, accessAssignment: row.roleId ? { role: { archived: row.archived ?? true, permissions: row.permissions || [] } } : null } : null
}
export function assignedPermissions(user: { role: string; accessAssignment?: { role: { archived: boolean; permissions: string[] } } | null }): Permission[] | undefined {
  if (user.role === "ADMIN" || !user.accessAssignment) return undefined
  return user.accessAssignment.role.archived ? [] : user.accessAssignment.role.permissions as Permission[]
}
