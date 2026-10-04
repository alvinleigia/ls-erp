BEGIN;
SET LOCAL app.rls_bypass = 'on';

-- Services were previously available to every business tenant's admin/manager.
-- Preserve that access at upgrade time. New tenants use explicit allowances.
-- Existing decisions are never overwritten when this migration is replayed.
INSERT INTO "TenantModule" ("tenantId", "key", "allowed", "enabled", "updatedAt")
SELECT "id", 'services', true, true, CURRENT_TIMESTAMP FROM "Tenant"
ON CONFLICT ("tenantId", "key") DO NOTHING;
COMMIT;
