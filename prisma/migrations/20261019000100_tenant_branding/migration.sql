ALTER TABLE "AppSetting" ADD COLUMN "branding" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "brandingVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppointmentOrder" ADD COLUMN "invoiceBranding" JSONB;
-- Freeze the existing invoice identity; do not apply a future logo to old orders.
UPDATE "AppointmentOrder" o SET "invoiceBranding" = jsonb_build_object('name', t.name, 'logo', NULL)
FROM "Tenant" t WHERE t.id = o."tenantId";
