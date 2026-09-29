BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);
-- AlterTable
ALTER TABLE "RealEstateProject" ADD COLUMN     "categoryNames" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "lifecycleName" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "RealEstateEnquiryContext" ADD COLUMN     "buyingTimeframeName" TEXT,
ADD COLUMN     "propertyCategoryName" TEXT;

-- AlterTable
ALTER TABLE "RealEstateOpportunityContext" ADD COLUMN     "buyingTimeframeName" TEXT,
ADD COLUMN     "propertyCategoryName" TEXT;

-- CreateTable
CREATE TABLE "RealEstateProjectStatus" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealEstateProjectStatus_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "RealEstatePropertyCategory" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealEstatePropertyCategory_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "RealEstateBuyingTimeframe" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealEstateBuyingTimeframe_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "RealEstateProjectCategory" (
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "RealEstateProjectCategory_pkey" PRIMARY KEY ("tenantId","projectId","categoryId")
);

-- CreateIndex
CREATE INDEX "RealEstateProjectStatus_tenantId_archived_position_name_id_idx" ON "RealEstateProjectStatus"("tenantId", "archived", "position", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateProjectStatus_tenantId_nameKey_key" ON "RealEstateProjectStatus"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "RealEstatePropertyCategory_tenantId_archived_position_name__idx" ON "RealEstatePropertyCategory"("tenantId", "archived", "position", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstatePropertyCategory_tenantId_nameKey_key" ON "RealEstatePropertyCategory"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "RealEstateBuyingTimeframe_tenantId_archived_position_name_i_idx" ON "RealEstateBuyingTimeframe"("tenantId", "archived", "position", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateBuyingTimeframe_tenantId_nameKey_key" ON "RealEstateBuyingTimeframe"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "RealEstateProjectCategory_tenantId_categoryId_projectId_idx" ON "RealEstateProjectCategory"("tenantId", "categoryId", "projectId");

-- AddForeignKey
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_lifecycle_fkey" FOREIGN KEY ("tenantId", "lifecycle") REFERENCES "RealEstateProjectStatus"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_propertyCategory_fkey" FOREIGN KEY ("tenantId", "propertyCategory") REFERENCES "RealEstatePropertyCategory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_buyingTimeframe_fkey" FOREIGN KEY ("tenantId", "buyingTimeframe") REFERENCES "RealEstateBuyingTimeframe"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_propertyCategory_fkey" FOREIGN KEY ("tenantId", "propertyCategory") REFERENCES "RealEstatePropertyCategory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_buyingTimeframe_fkey" FOREIGN KEY ("tenantId", "buyingTimeframe") REFERENCES "RealEstateBuyingTimeframe"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateProjectStatus" ADD CONSTRAINT "RealEstateProjectStatus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstatePropertyCategory" ADD CONSTRAINT "RealEstatePropertyCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateBuyingTimeframe" ADD CONSTRAINT "RealEstateBuyingTimeframe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateProjectCategory" ADD CONSTRAINT "RealEstateProjectCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateProjectCategory" ADD CONSTRAINT "RealEstateProjectCategory_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "RealEstateProject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "RealEstateProjectCategory" ADD CONSTRAINT "RealEstateProjectCategory_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "RealEstatePropertyCategory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- Match the existing tenant RLS contract.
ALTER TABLE "RealEstateProjectStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateProjectStatus" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateProjectStatus" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstatePropertyCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstatePropertyCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstatePropertyCategory" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateBuyingTimeframe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateBuyingTimeframe" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateBuyingTimeframe" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateProjectCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateProjectCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateProjectCategory" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
CREATE UNIQUE INDEX "RealEstateProjectStatus_one_default" ON "RealEstateProjectStatus" ("tenantId") WHERE "isDefault";
ALTER TABLE "RealEstateProjectStatus" ADD CONSTRAINT "RealEstateProjectStatus_values_check" CHECK (version > 0 AND position BETWEEN 0 AND 1000000 AND length(name) BETWEEN 1 AND 100 AND NOT (archived AND "isDefault"));
CREATE UNIQUE INDEX "RealEstatePropertyCategory_one_default" ON "RealEstatePropertyCategory" ("tenantId") WHERE "isDefault";
ALTER TABLE "RealEstatePropertyCategory" ADD CONSTRAINT "RealEstatePropertyCategory_values_check" CHECK (version > 0 AND position BETWEEN 0 AND 1000000 AND length(name) BETWEEN 1 AND 100 AND NOT (archived AND "isDefault"));
CREATE UNIQUE INDEX "RealEstateBuyingTimeframe_one_default" ON "RealEstateBuyingTimeframe" ("tenantId") WHERE "isDefault";
ALTER TABLE "RealEstateBuyingTimeframe" ADD CONSTRAINT "RealEstateBuyingTimeframe_values_check" CHECK (version > 0 AND position BETWEEN 0 AND 1000000 AND length(name) BETWEEN 1 AND 100 AND NOT (archived AND "isDefault"));

-- Stable legacy IDs preserve existing API values and report filters.
-- Invoker rights retain tenant RLS during ordinary tenant provisioning.
CREATE FUNCTION app.seed_property_choices(target text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
INSERT INTO "RealEstateProjectStatus" ("tenantId",id,name,"nameKey",position,"isDefault","updatedAt") VALUES
(target, 'PLANNING', 'Planning', 'planning', 0, true, CURRENT_TIMESTAMP),
(target, 'PRE_LAUNCH', 'Pre launch', 'pre launch', 10, false, CURRENT_TIMESTAMP),
(target, 'SELLING', 'Selling', 'selling', 20, false, CURRENT_TIMESTAMP),
(target, 'ON_HOLD', 'On hold', 'on hold', 30, false, CURRENT_TIMESTAMP),
(target, 'CLOSED', 'Closed', 'closed', 40, false, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
INSERT INTO "RealEstatePropertyCategory" ("tenantId",id,name,"nameKey",position,"isDefault","updatedAt") VALUES
(target, 'APARTMENT', 'Apartment', 'apartment', 0, false, CURRENT_TIMESTAMP),
(target, 'VILLA', 'Villa', 'villa', 10, false, CURRENT_TIMESTAMP),
(target, 'PLOT', 'Plot', 'plot', 20, false, CURRENT_TIMESTAMP),
(target, 'OFFICE', 'Office', 'office', 30, false, CURRENT_TIMESTAMP),
(target, 'RETAIL', 'Retail', 'retail', 40, false, CURRENT_TIMESTAMP),
(target, 'INDUSTRIAL', 'Industrial', 'industrial', 50, false, CURRENT_TIMESTAMP),
(target, 'MIXED_USE', 'Mixed use', 'mixed use', 60, false, CURRENT_TIMESTAMP),
(target, 'OTHER', 'Other', 'other', 70, false, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
INSERT INTO "RealEstateBuyingTimeframe" ("tenantId",id,name,"nameKey",position,"isDefault","updatedAt") VALUES
(target, 'ASAP', 'Asap', 'asap', 0, false, CURRENT_TIMESTAMP),
(target, 'WITHIN_3_MONTHS', 'Within 3 months', 'within 3 months', 10, false, CURRENT_TIMESTAMP),
(target, '3_TO_6_MONTHS', '3 to 6 months', '3 to 6 months', 20, false, CURRENT_TIMESTAMP),
(target, '6_TO_12_MONTHS', '6 to 12 months', '6 to 12 months', 30, false, CURRENT_TIMESTAMP),
(target, 'OVER_12_MONTHS', 'Over 12 months', 'over 12 months', 40, false, CURRENT_TIMESTAMP),
(target, 'EXPLORING', 'Exploring', 'exploring', 50, false, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
END; $$;
SELECT app.seed_property_choices(id) FROM "Tenant";
CREATE FUNCTION app.seed_property_choices_for_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM app.seed_property_choices(NEW.id); RETURN NEW; END; $$;
CREATE TRIGGER tenant_property_choices AFTER INSERT ON "Tenant" FOR EACH ROW EXECUTE FUNCTION app.seed_property_choices_for_tenant();

ALTER TABLE "RealEstateProject" DROP CONSTRAINT IF EXISTS "RealEstateProject_lifecycle_check";
ALTER TABLE "RealEstateEnquiryContext" DROP CONSTRAINT IF EXISTS "RealEstateEnquiryContext_requirements_check";
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_requirements_check" CHECK (
 ("subprojectId" IS NULL OR "projectId" IS NOT NULL)
 AND ("budgetMin" IS NULL OR "budgetMin" >= 0) AND ("budgetMax" IS NULL OR "budgetMax" >= 0)
 AND ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
 AND (("budgetMin" IS NULL AND "budgetMax" IS NULL) OR "budgetCurrency" IS NOT NULL)
 AND ("budgetCurrency" IS NULL OR "budgetCurrency" ~ '^[A-Z]{3}$')
 AND (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 50));
UPDATE "RealEstateEnquiryContext" c SET "propertyCategoryName" = k.name FROM "RealEstatePropertyCategory" k WHERE k."tenantId"=c."tenantId" AND k.id=c."propertyCategory";
UPDATE "RealEstateEnquiryContext" c SET "buyingTimeframeName" = k.name FROM "RealEstateBuyingTimeframe" k WHERE k."tenantId"=c."tenantId" AND k.id=c."buyingTimeframe";
ALTER TABLE "RealEstateOpportunityContext" DROP CONSTRAINT IF EXISTS "RealEstateOpportunityContext_requirements_check";
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_requirements_check" CHECK (
 ("subprojectId" IS NULL OR "projectId" IS NOT NULL)
 AND ("budgetMin" IS NULL OR "budgetMin" >= 0) AND ("budgetMax" IS NULL OR "budgetMax" >= 0)
 AND ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
 AND (("budgetMin" IS NULL AND "budgetMax" IS NULL) OR "budgetCurrency" IS NOT NULL)
 AND ("budgetCurrency" IS NULL OR "budgetCurrency" ~ '^[A-Z]{3}$')
 AND (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 50));
UPDATE "RealEstateOpportunityContext" c SET "propertyCategoryName" = k.name FROM "RealEstatePropertyCategory" k WHERE k."tenantId"=c."tenantId" AND k.id=c."propertyCategory";
UPDATE "RealEstateOpportunityContext" c SET "buyingTimeframeName" = k.name FROM "RealEstateBuyingTimeframe" k WHERE k."tenantId"=c."tenantId" AND k.id=c."buyingTimeframe";

UPDATE "RealEstateProject" p SET "lifecycleName" = s.name FROM "RealEstateProjectStatus" s WHERE s."tenantId"=p."tenantId" AND s.id=p.lifecycle;
INSERT INTO "RealEstateProjectCategory" ("tenantId","projectId","categoryId") SELECT DISTINCT p."tenantId",p.id,unnest(p.categories) FROM "RealEstateProject" p;
UPDATE "RealEstateProject" p SET "categoryNames" = COALESCE((SELECT jsonb_object_agg(c.id,c.name) FROM "RealEstatePropertyCategory" c WHERE c."tenantId"=p."tenantId" AND c.id=ANY(p.categories)), '{}'::jsonb);

-- Keep label snapshots across unrelated edits and catalog renames, including
-- old clients. Conversion can carry the original buyer-label snapshots.
CREATE FUNCTION app.property_project_labels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT name INTO NEW."lifecycleName" FROM "RealEstateProjectStatus" WHERE "tenantId"=NEW."tenantId" AND id=NEW.lifecycle;
 ELSIF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
   SELECT name INTO NEW."lifecycleName" FROM "RealEstateProjectStatus" WHERE "tenantId"=NEW."tenantId" AND id=NEW.lifecycle;
 ELSE NEW."lifecycleName" := OLD."lifecycleName";
 END IF;
 IF TG_OP='INSERT' THEN
   SELECT COALESCE(jsonb_object_agg(id,name),'{}'::jsonb) INTO NEW."categoryNames" FROM "RealEstatePropertyCategory" WHERE "tenantId"=NEW."tenantId" AND id=ANY(NEW.categories);
 ELSE
   SELECT COALESCE(jsonb_object_agg(id,COALESCE(OLD."categoryNames"->>id,name)),'{}'::jsonb) INTO NEW."categoryNames" FROM "RealEstatePropertyCategory" WHERE "tenantId"=NEW."tenantId" AND id=ANY(NEW.categories);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER property_project_labels BEFORE INSERT OR UPDATE OF lifecycle,categories ON "RealEstateProject" FOR EACH ROW EXECUTE FUNCTION app.property_project_labels();
CREATE FUNCTION app.sync_property_categories() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM "RealEstateProjectCategory" WHERE "tenantId"=NEW."tenantId" AND "projectId"=NEW.id AND NOT ("categoryId"=ANY(NEW.categories));
 INSERT INTO "RealEstateProjectCategory" ("tenantId","projectId","categoryId") SELECT DISTINCT NEW."tenantId",NEW.id,unnest(NEW.categories) ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $$;
CREATE TRIGGER sync_property_categories AFTER INSERT OR UPDATE OF categories ON "RealEstateProject" FOR EACH ROW EXECUTE FUNCTION app.sync_property_categories();
CREATE FUNCTION app.property_buyer_labels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW."propertyCategory" IS NOT DISTINCT FROM OLD."propertyCategory" THEN NEW."propertyCategoryName":=OLD."propertyCategoryName";
   ELSE NEW."propertyCategoryName":=NULL; END IF;
   IF NEW."buyingTimeframe" IS NOT DISTINCT FROM OLD."buyingTimeframe" THEN NEW."buyingTimeframeName":=OLD."buyingTimeframeName";
   ELSE NEW."buyingTimeframeName":=NULL; END IF;
 END IF;
 IF NEW."propertyCategory" IS NULL THEN NEW."propertyCategoryName":=NULL;
 ELSIF NEW."propertyCategoryName" IS NULL THEN
   SELECT name INTO NEW."propertyCategoryName" FROM "RealEstatePropertyCategory" WHERE "tenantId"=NEW."tenantId" AND id=NEW."propertyCategory";
 END IF;
 IF NEW."buyingTimeframe" IS NULL THEN NEW."buyingTimeframeName":=NULL;
 ELSIF NEW."buyingTimeframeName" IS NULL THEN
   SELECT name INTO NEW."buyingTimeframeName" FROM "RealEstateBuyingTimeframe" WHERE "tenantId"=NEW."tenantId" AND id=NEW."buyingTimeframe";
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER property_buyer_labels BEFORE INSERT OR UPDATE OF "propertyCategory","buyingTimeframe" ON "RealEstateEnquiryContext" FOR EACH ROW EXECUTE FUNCTION app.property_buyer_labels();
CREATE TRIGGER property_buyer_labels BEFORE INSERT OR UPDATE OF "propertyCategory","buyingTimeframe" ON "RealEstateOpportunityContext" FOR EACH ROW EXECUTE FUNCTION app.property_buyer_labels();
ALTER TABLE "RealEstateProject" VALIDATE CONSTRAINT "RealEstateProject_tenantId_lifecycle_fkey";
ALTER TABLE "RealEstateEnquiryContext" VALIDATE CONSTRAINT "RealEstateEnquiryContext_tenantId_propertyCategory_fkey";
ALTER TABLE "RealEstateEnquiryContext" VALIDATE CONSTRAINT "RealEstateEnquiryContext_tenantId_buyingTimeframe_fkey";
ALTER TABLE "RealEstateOpportunityContext" VALIDATE CONSTRAINT "RealEstateOpportunityContext_tenantId_propertyCategory_fkey";
ALTER TABLE "RealEstateOpportunityContext" VALIDATE CONSTRAINT "RealEstateOpportunityContext_tenantId_buyingTimeframe_fkey";
ALTER TABLE "RealEstateProjectStatus" VALIDATE CONSTRAINT "RealEstateProjectStatus_tenantId_fkey";
ALTER TABLE "RealEstatePropertyCategory" VALIDATE CONSTRAINT "RealEstatePropertyCategory_tenantId_fkey";
ALTER TABLE "RealEstateBuyingTimeframe" VALIDATE CONSTRAINT "RealEstateBuyingTimeframe_tenantId_fkey";
ALTER TABLE "RealEstateProjectCategory" VALIDATE CONSTRAINT "RealEstateProjectCategory_tenantId_fkey";
ALTER TABLE "RealEstateProjectCategory" VALIDATE CONSTRAINT "RealEstateProjectCategory_tenantId_projectId_fkey";
ALTER TABLE "RealEstateProjectCategory" VALIDATE CONSTRAINT "RealEstateProjectCategory_tenantId_categoryId_fkey";
COMMIT;
