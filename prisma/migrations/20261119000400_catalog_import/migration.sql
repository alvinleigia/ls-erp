BEGIN;
CREATE TABLE "CatalogImport" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT,
 "createdByUserId" text NOT NULL, profile text NOT NULL, "templateVersion" integer NOT NULL DEFAULT 1 CHECK("templateVersion"=1),
 "fileName" text NOT NULL, status text NOT NULL DEFAULT 'VALIDATING' CHECK(status IN ('VALIDATING','REVIEW','IMPORTING','COMPLETE')),
 headers jsonb NOT NULL CHECK(jsonb_typeof(headers)='array'),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 UNIQUE("tenantId",id),
 FOREIGN KEY("tenantId","createdByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
CREATE INDEX "CatalogImport_tenantId_createdByUserId_createdAt_id_idx" ON "CatalogImport"("tenantId","createdByUserId","createdAt",id);
CREATE TABLE "CatalogImportRow" (
 "tenantId" text NOT NULL, "importId" text NOT NULL, "rowNumber" integer NOT NULL CHECK("rowNumber">1),
 values jsonb NOT NULL CHECK(jsonb_typeof(values)='array'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','READY','INVALID','DUPLICATE','IMPORTED')),
 errors jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(errors)='array'), "itemCode" text, input jsonb, "itemId" text,
 PRIMARY KEY("tenantId","importId","rowNumber"),
 FOREIGN KEY("tenantId","importId") REFERENCES "CatalogImport"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","itemId") REFERENCES "CatalogItem"("tenantId",id) ON DELETE RESTRICT,
 CHECK((status='IMPORTED')=("itemId" IS NOT NULL))
);
CREATE INDEX "CatalogImportRow_tenantId_importId_status_rowNumber_idx" ON "CatalogImportRow"("tenantId","importId",status,"rowNumber");
CREATE INDEX "CatalogImportRow_tenantId_importId_itemCode_rowNumber_idx" ON "CatalogImportRow"("tenantId","importId","itemCode","rowNumber");
ALTER TABLE "CatalogImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CatalogImport" USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY creator_private ON "CatalogImport" AS RESTRICTIVE USING(app.rls_bypass() OR "createdByUserId"=current_setting('app.actor_id',true)) WITH CHECK(app.rls_bypass() OR "createdByUserId"=current_setting('app.actor_id',true));
ALTER TABLE "CatalogImportRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogImportRow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CatalogImportRow" USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY creator_private ON "CatalogImportRow" AS RESTRICTIVE USING(EXISTS(SELECT 1 FROM "CatalogImport" b WHERE b."tenantId"="CatalogImportRow"."tenantId" AND b.id="CatalogImportRow"."importId")) WITH CHECK(EXISTS(SELECT 1 FROM "CatalogImport" b WHERE b."tenantId"="CatalogImportRow"."tenantId" AND b.id="CatalogImportRow"."importId"));
CREATE FUNCTION app.catalog_import_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Import history is retained' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='CatalogImport' THEN
  IF (to_jsonb(NEW)-ARRAY['status','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updatedAt']) THEN RAISE EXCEPTION 'Import source is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW."tenantId",NEW."importId",NEW."rowNumber",NEW.values) IS DISTINCT FROM (OLD."tenantId",OLD."importId",OLD."rowNumber",OLD.values) OR OLD.status='IMPORTED' THEN RAISE EXCEPTION 'Import source and completed results are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_import_immutable BEFORE UPDATE OR DELETE ON "CatalogImport" FOR EACH ROW EXECUTE FUNCTION app.catalog_import_immutable();
CREATE TRIGGER catalog_import_row_immutable BEFORE UPDATE OR DELETE ON "CatalogImportRow" FOR EACH ROW EXECUTE FUNCTION app.catalog_import_immutable();
-- Empty tables only: no tenant feature, access profile or inventory is changed.
COMMIT;
