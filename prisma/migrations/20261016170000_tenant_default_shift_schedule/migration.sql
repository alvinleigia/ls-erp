BEGIN;

-- Default schedules belong to a tenant. The old global partial index prevented
-- a second business from creating its own default; no records are rewritten.
DROP INDEX IF EXISTS "ShiftSchedule_default_unique";
CREATE UNIQUE INDEX "ShiftSchedule_tenant_default_unique"
ON "ShiftSchedule" ("tenantId") WHERE "isDefault" = true;

COMMIT;
