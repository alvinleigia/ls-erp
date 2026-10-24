import { Prisma, PrismaClient, Role } from "@prisma/client"

import { logger } from "@/lib/logger"

type DbClient = PrismaClient | Prisma.TransactionClient

type DomainAuditInput = {
  tenantId?: string | null
  event: string
  entityType: string
  entityId?: string | null
  actorUserId?: string | null
  actorRole?: string | null
  requestId?: string | null
  metadata?: Prisma.InputJsonValue
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
}

const isRole = (value: string): value is Role =>
  (Object.values(Role) as string[]).includes(value)

const normalizeRole = (value?: string | null): Role | null => {
  if (!value) return null
  return isRole(value) ? value : null
}

export const recordDomainAuditEvent = async (db: DbClient, input: DomainAuditInput) => {
  logger.info(`domain.${input.event}`, {
    requestId: input.requestId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata,
  })

  // Logging an authorized mutation must not require reading its audit copy.
  await db.auditLog.createMany({
    data: {
      tenantId: input.tenantId ?? null,
      event: input.event,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorRole: normalizeRole(input.actorRole),
      requestId: input.requestId ?? null,
      metadata: input.metadata,
      before: input.before,
      after: input.after,
    },
  })
}

export const recordDomainAuditEventSafe = async (db: DbClient, input: DomainAuditInput) => {
  try {
    await recordDomainAuditEvent(db, input)
  } catch (error) {
    logger.warn("domain.audit_log_failed", {
      requestId: input.requestId ?? null,
      event: input.event,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      error,
    })
  }
}
