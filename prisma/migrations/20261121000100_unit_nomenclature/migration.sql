BEGIN;
ALTER TABLE "RealEstateUnit" ADD COLUMN "unitNumber" text, ADD COLUMN "companyCode" text, ADD COLUMN floor text;
-- Retain existing business references exactly. Never infer a physical number.
UPDATE "RealEstateUnit" u SET "companyCode"=i.code FROM "CatalogItem" i WHERE i."tenantId"=u."tenantId" AND i.id=u."itemId";
ALTER TABLE "RealEstateUnit" ADD CONSTRAINT property_unit_nomenclature_valid CHECK (
 ("unitNumber" IS NULL OR ("unitNumber"=btrim("unitNumber") AND length("unitNumber") BETWEEN 1 AND 60 AND "unitNumber"!~'[[:cntrl:]]')) AND
 ("companyCode" IS NULL OR ("companyCode"=btrim("companyCode") AND length("companyCode") BETWEEN 1 AND 100 AND "companyCode"!~'[[:cntrl:]]')) AND
 (floor IS NULL OR (floor=btrim(floor) AND length(floor) BETWEEN 1 AND 40 AND floor!~'[[:cntrl:]]')));
-- The physical project/building node is the namespace, never the launch phase.
CREATE UNIQUE INDEX property_unit_number_unique ON "RealEstateUnit"("tenantId","projectId",lower("unitNumber")) WHERE "unitNumber" IS NOT NULL;
CREATE UNIQUE INDEX property_unit_company_code_unique ON "RealEstateUnit"("tenantId","projectId",lower("companyCode")) WHERE "companyCode" IS NOT NULL;
DROP INDEX "CatalogImportRow_tenantId_importId_itemCode_rowNumber_idx";
ALTER TABLE "CatalogImportRow" RENAME COLUMN "itemCode" TO "matchKeys";
ALTER TABLE "CatalogImportRow" ALTER COLUMN "matchKeys" TYPE text[] USING CASE WHEN "matchKeys" IS NULL THEN '{}'::text[] ELSE ARRAY["matchKeys"] END;
ALTER TABLE "CatalogImportRow" ALTER COLUMN "matchKeys" SET DEFAULT '{}', ALTER COLUMN "matchKeys" SET NOT NULL;
CREATE INDEX "CatalogImportRow_matchKeys_idx" ON "CatalogImportRow" USING gin("matchKeys");
ALTER TABLE "CatalogImport" ALTER COLUMN "templateVersion" SET DEFAULT 3;
ALTER TABLE "CatalogImport" DROP CONSTRAINT "CatalogImport_templateVersion_check";
ALTER TABLE "CatalogImport" ADD CONSTRAINT "CatalogImport_templateVersion_check" CHECK("templateVersion" IN (1,2,3));
COMMIT;
