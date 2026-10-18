BEGIN;
CREATE TABLE "CatalogItem" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('PRODUCT','UNIT')),
  unit TEXT NOT NULL DEFAULT 'unit', price DECIMAL(18,4) NOT NULL CHECK (price >= 0), currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  availability TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (availability IN ('AVAILABLE','UNAVAILABLE','SOLD')),
  archived BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "extensionKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenantId", id),
  CONSTRAINT "CatalogItem_code_valid" CHECK (code = upper(code) AND code ~ '^[A-Z0-9][A-Z0-9._/-]{0,59}$'),
  CONSTRAINT "CatalogItem_unit_sale" CHECK (kind = 'UNIT' OR availability <> 'SOLD')
);
CREATE UNIQUE INDEX "CatalogItem_tenantId_code_key" ON "CatalogItem"("tenantId",code);
CREATE INDEX "CatalogItem_tenantId_archived_availability_name_id_idx" ON "CatalogItem"("tenantId",archived,availability,name,id);
CREATE INDEX "CatalogItem_tenantId_archived_name_id_idx" ON "CatalogItem"("tenantId",archived,name,id);
CREATE INDEX "CatalogItem_tenantId_extensionKey_idx" ON "CatalogItem"("tenantId","extensionKey");
CREATE TABLE "RealEstateUnit" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "itemId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "categoryId" TEXT NOT NULL,
  bedrooms INTEGER CHECK (bedrooms BETWEEN 0 AND 100), area DECIMAL(18,4) CHECK (area > 0),
  "areaUnit" TEXT NOT NULL DEFAULT 'SQ_FT' CHECK ("areaUnit" IN ('SQ_FT','SQ_M')),
  PRIMARY KEY ("tenantId","itemId"),
  FOREIGN KEY ("tenantId","itemId") REFERENCES "CatalogItem"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId","projectId") REFERENCES "RealEstateProject"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId","categoryId") REFERENCES "RealEstatePropertyCategory"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RealEstateUnit_tenantId_projectId_itemId_idx" ON "RealEstateUnit"("tenantId","projectId","itemId");
CREATE INDEX "RealEstateUnit_tenantId_categoryId_idx" ON "RealEstateUnit"("tenantId","categoryId");
ALTER TABLE "CatalogItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CatalogItem" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateUnit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateUnit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateUnit" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
-- Optional feature: no existing tenant is granted or enabled automatically.
COMMIT;
