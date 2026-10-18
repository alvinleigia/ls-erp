BEGIN;

-- Additive configuration only. Existing tenants resolve to code-owned defaults.
CREATE TABLE "TenantTerminologyRevision" (
  "tenantId" TEXT NOT NULL PRIMARY KEY REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE TABLE "TenantTerminology" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60 AND label = btrim(label)),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenantId", key)
);
ALTER TABLE "TenantTerminologyRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantTerminologyRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantTerminologyRevision" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "TenantTerminology" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantTerminology" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantTerminology" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));

COMMIT;
