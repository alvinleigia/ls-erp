CREATE TABLE "CrmEnquiryImport" (
  id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT,
  "createdByUserId" TEXT NOT NULL, "fileName" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'MAPPING' CHECK (status IN ('MAPPING','VALIDATING','REVIEW','IMPORTING','COMPLETE')),
  headers JSONB NOT NULL, config JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("tenantId",id)
);
CREATE INDEX "CrmEnquiryImport_tenantId_createdByUserId_createdAt_id_idx" ON "CrmEnquiryImport"("tenantId","createdByUserId","createdAt",id);
CREATE TABLE "CrmEnquiryImportRow" (
  "tenantId" TEXT NOT NULL, "importId" TEXT NOT NULL, "rowNumber" INTEGER NOT NULL,
  values JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY','INVALID','DUPLICATE','IMPORTED')),
  errors JSONB NOT NULL DEFAULT '[]', email TEXT, phone TEXT, "enquiryId" TEXT,
  PRIMARY KEY ("tenantId","importId","rowNumber"),
  FOREIGN KEY ("tenantId","importId") REFERENCES "CrmEnquiryImport"("tenantId",id) ON DELETE CASCADE
);
CREATE INDEX "CrmEnquiryImportRow_tenantId_importId_status_rowNumber_idx" ON "CrmEnquiryImportRow"("tenantId","importId",status,"rowNumber");
CREATE INDEX "CrmEnquiryImportRow_tenantId_importId_email_rowNumber_idx" ON "CrmEnquiryImportRow"("tenantId","importId",email,"rowNumber");
CREATE INDEX "CrmEnquiryImportRow_tenantId_importId_phone_rowNumber_idx" ON "CrmEnquiryImportRow"("tenantId","importId",phone,"rowNumber");
-- Case-insensitive duplicate checks, including older mixed-case contact emails.
CREATE INDEX "CrmContact_tenantId_email_lower_idx" ON "CrmContact"("tenantId",lower(email));
ALTER TABLE "CrmEnquiryImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmEnquiryImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmEnquiryImport" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmEnquiryImportRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmEnquiryImportRow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmEnquiryImportRow" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
