BEGIN;
-- Preserve existing CRM businesses' access. New tenants receive no optional flags.
-- Migration-only context: TenantModule uses forced tenant RLS.
SELECT set_config('app.rls_bypass', 'on', true);
INSERT INTO "TenantModule" ("tenantId", "key", "enabled", "updatedAt")
SELECT "tenantId", 'salesDocuments', true, CURRENT_TIMESTAMP
FROM "TenantModule" WHERE "key" = 'crm' AND "enabled" = true
ON CONFLICT ("tenantId", "key") DO NOTHING;
INSERT INTO "TenantModule" ("tenantId", "key", "enabled", "updatedAt")
SELECT "tenantId", 'paymentPlans', true, CURRENT_TIMESTAMP
FROM "TenantModule" WHERE "key" = 'salesDocuments' AND "enabled" = true
ON CONFLICT ("tenantId", "key") DO NOTHING;
CREATE INDEX "CrmQuotation_tenantId_createdAt_id_idx" ON "CrmQuotation"("tenantId", "createdAt" DESC, "id");
COMMIT;
