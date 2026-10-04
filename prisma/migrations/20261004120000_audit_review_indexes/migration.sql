-- Tenant-bound chronological browsing and exact actor/record history lookups.
CREATE INDEX "AuditLog_tenantId_createdAt_id_idx" ON "AuditLog" ("tenantId", "createdAt", id);
CREATE INDEX "AuditLog_tenantId_actorUserId_createdAt_id_idx" ON "AuditLog" ("tenantId", "actorUserId", "createdAt", id);
CREATE INDEX "AuditLog_tenantId_entityType_entityId_createdAt_id_idx" ON "AuditLog" ("tenantId", "entityType", "entityId", "createdAt", id);
