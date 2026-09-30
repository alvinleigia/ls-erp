BEGIN;
SET LOCAL app.rls_bypass = 'on';

ALTER TABLE "TenantModule" ADD COLUMN "allowed" BOOLEAN NOT NULL DEFAULT false;

-- Existing tenants retain their module choices and their ability to activate
-- the four modules offered before platform allowances were introduced.
INSERT INTO "TenantModule" ("tenantId", "key", "allowed", "enabled", "updatedAt")
SELECT t."id", m."key", true, false, CURRENT_TIMESTAMP
FROM "Tenant" t CROSS JOIN (VALUES ('crm'), ('realEstate'), ('salesDocuments'), ('paymentPlans')) AS m("key")
ON CONFLICT ("tenantId", "key") DO UPDATE SET "allowed" = true;

ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_enabled_requires_allowance"
  CHECK (NOT "enabled" OR "allowed");
COMMIT;
