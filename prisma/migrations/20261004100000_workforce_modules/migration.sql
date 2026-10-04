BEGIN;
SET LOCAL app.rls_bypass = 'on';
-- Preserve legacy access; explicit platform/tenant choices are never overwritten.
INSERT INTO "TenantModule" ("tenantId", "key", "allowed", "enabled", "updatedAt")
SELECT t.id, m.key, true, true, CURRENT_TIMESTAMP FROM "Tenant" t
CROSS JOIN (VALUES ('leaves'), ('shifts')) m(key)
ON CONFLICT ("tenantId", "key") DO NOTHING;
COMMIT;
