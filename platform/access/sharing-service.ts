import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, type BusinessActor } from "../policy"
import { authorizeBusinessOperation } from "./operation"
import { sharingRecords, sharingResource, type SharingResource } from "./sharing-registry"
import { recordDomainAuditEvent } from "@/lib/domain-audit"

const recipient = z.object({ kind: z.enum(["USER", "TEAM"]), id: z.string().min(1).max(100), level: z.enum(["READ", "EDIT"]) }).strict()
export const recordSharingSchema = z.object({ version: z.number().int().nonnegative(), restricted: z.boolean(), grants: z.array(recipient).max(200) }).strict().superRefine((value, ctx) => {
  if (new Set(value.grants.map(g => `${g.kind}:${g.id}`)).size !== value.grants.length) ctx.addIssue({ code: "custom", path: ["grants"], message: "Choose each person or team only once." })
})
type Identity = Pick<BusinessActor, "tenantId" | "userId" | "requestId">
type Row = { id: string; sharingPolicyId: string | null; parentId?: string | null; [key: string]: unknown }
type Delegate = { findFirst(args: { where: { tenantId: string; id: string } }): Promise<Row | null>; updateMany(args: { where: { tenantId: string; id: string }; data: { sharingPolicyId: string } }): Promise<{ count: number }> }
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))

export function createRecordSharingService(db: PrismaClient, identity: Identity) {
  async function run<T>(resource: string, id: string, write: boolean, operation: (tx: Prisma.TransactionClient, actor: BusinessActor, key: SharingResource, row: Row, inherited: boolean) => Promise<T>) {
    z.string().min(1).max(100).parse(id)
    const key = sharingResource(resource)
    if (!key) throw new BusinessError(404, "Sharing is not available for this record type.")
    return db.$transaction(async tx => {
      const definition = sharingRecords[key]
      const actor = await authorizeBusinessOperation(tx, identity, `${key}.read`, [definition.module])
      if (actor.role !== "ADMIN") throw new BusinessError(403, "A tenant administrator must manage record sharing.")
      const delegate = tx[definition.model] as unknown as Delegate
      let row = await delegate.findFirst({ where: { tenantId: actor.tenantId, id } })
      if (!row) throw new BusinessError(404, "Record not found.")
      const inherited = key === "projects" && !!row.parentId
      if (inherited) row = await delegate.findFirst({ where: { tenantId: actor.tenantId, id: row.parentId as string } })
      if (!row) throw new BusinessError(404, "Parent record not found.")
      if (write) await tx.$queryRaw(Prisma.sql`SELECT id FROM ${Prisma.raw(`"${definition.table}"`)} WHERE "tenantId"=${actor.tenantId} AND id=${row.id} FOR UPDATE`)
      return operation(tx, actor, key, row, inherited)
    }, { maxWait: 20000, timeout: 20000 })
  }
  const existing = (tx: Prisma.TransactionClient, tenantId: string, key: SharingResource, id: string) => tx.recordSharingPolicy.findUnique({ where: { tenantId_resource_recordId: { tenantId, resource: key, recordId: id } }, include: { grants: { include: { user: { select: { name: true, email: true, status: true } }, team: { select: { name: true, archived: true } } }, orderBy: { id: "asc" } } } })
  return {
    get(resource: string, id: string) {
      return run(resource, id, false, async (tx, actor, key, row, inherited) => {
        const policy = await existing(tx, actor.tenantId, key, row.id)
        return { resource: key, recordId: row.id, title: String(row[sharingRecords[key].title] || sharingRecords[key].label), inherited,
          restricted: policy?.restricted ?? false, version: policy?.version ?? 0,
          grants: policy?.grants.map(g => ({ kind: g.userId ? "USER" as const : "TEAM" as const, id: g.userId || g.teamId!, level: g.level as "READ" | "EDIT", name: g.user ? g.user.name || g.user.email : g.team!.name, inactive: g.user ? g.user.status !== "ACTIVE" : !!g.team?.archived })) ?? [],
        }
      })
    },
    save(resource: string, id: string, input: unknown) {
      const data = recordSharingSchema.parse(input)
      return run(resource, id, true, async (tx, actor, key, row) => {
        const before = await existing(tx, actor.tenantId, key, row.id)
        if ((before?.version ?? 0) !== data.version) throw new BusinessError(409, "Sharing changed. Reload before saving.")
        const users = data.grants.filter(g => g.kind === "USER").map(g => g.id), teams = data.grants.filter(g => g.kind === "TEAM").map(g => g.id)
        const [userCount, teamCount] = await Promise.all([
          tx.user.count({ where: { tenantId: actor.tenantId, id: { in: users }, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "STAFF"] } } }),
          tx.businessTeam.count({ where: { tenantId: actor.tenantId, id: { in: teams }, archived: false } }),
        ])
        if (userCount !== users.length || teamCount !== teams.length) throw new BusinessError(400, "Choose active business users and teams from this tenant. Remove inactive recipients before saving.")
        const policy = before
          ? await tx.recordSharingPolicy.update({ where: { id: before.id, version: data.version }, data: { restricted: data.restricted, version: { increment: 1 }, grants: { deleteMany: {} } } })
          : await tx.recordSharingPolicy.create({ data: { tenantId: actor.tenantId, resource: key, recordId: row.id, restricted: data.restricted } })
        if (data.grants.length) await tx.recordSharingGrant.createMany({ data: data.grants.map(g => ({ tenantId: actor.tenantId, policyId: policy.id, userId: g.kind === "USER" ? g.id : null, teamId: g.kind === "TEAM" ? g.id : null, level: g.level })) })
        const delegate = tx[sharingRecords[key].model] as unknown as Delegate
        await delegate.updateMany({ where: { tenantId: actor.tenantId, id: row.id }, data: { sharingPolicyId: policy.id } })
        await recordDomainAuditEvent(tx, { tenantId: actor.tenantId, actorUserId: actor.userId, actorRole: actor.role, requestId: actor.requestId, event: "access.recordSharing.updated", entityType: "RecordSharingPolicy", entityId: policy.id,
          before: before ? json({ restricted: before.restricted, version: before.version, grants: before.grants.map(g => ({ userId: g.userId, teamId: g.teamId, level: g.level })) }) : undefined,
          after: json({ resource: key, recordId: row.id, restricted: data.restricted, version: policy.version, grants: data.grants }),
        })
        return { resource: key, recordId: row.id, version: policy.version }
      })
    },
  }
}
