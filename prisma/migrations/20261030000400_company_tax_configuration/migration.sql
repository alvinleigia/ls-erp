BEGIN;
-- CreateTable
CREATE TABLE "CompanyTaxRegistration" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "eInvoicePolicy" TEXT NOT NULL DEFAULT 'UNASSESSED',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxRegistration_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "CompanyTaxRegistrationRevision" (
    "tenantId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTaxRegistrationRevision_pkey" PRIMARY KEY ("tenantId","registrationId","version")
);

-- CreateTable
CREATE TABLE "OfficeTaxRegistration" (
    "tenantId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registrationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeTaxRegistration_pkey" PRIMARY KEY ("tenantId","officeId")
);

-- CreateTable
CREATE TABLE "CompanyTaxProfile" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxProfile_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "CompanyTaxProfileVersion" (
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTaxProfileVersion_pkey" PRIMARY KEY ("tenantId","profileId","version")
);

-- CreateTable
CREATE TABLE "CompanyTaxProfileRate" (
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "variantKey" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" DECIMAL(20,12) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyTaxProfileRate_pkey" PRIMARY KEY ("tenantId","profileId","profileVersion","variantKey","componentCode")
);

-- CreateIndex
CREATE INDEX "CompanyTaxRegistration_tenantId_companyId_archived_label_id_idx" ON "CompanyTaxRegistration"("tenantId", "companyId", "archived", "label", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxRegistration_tenantId_companyId_id_key" ON "CompanyTaxRegistration"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxRegistration_tenantId_scheme_registrationNumber_key" ON "CompanyTaxRegistration"("tenantId", "scheme", "registrationNumber");

-- CreateIndex
CREATE INDEX "OfficeTaxRegistration_tenantId_registrationId_idx" ON "OfficeTaxRegistration"("tenantId", "registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeTaxRegistration_tenantId_companyId_officeId_key" ON "OfficeTaxRegistration"("tenantId", "companyId", "officeId");

-- CreateIndex
CREATE INDEX "CompanyTaxProfile_tenantId_companyId_enabled_name_id_idx" ON "CompanyTaxProfile"("tenantId", "companyId", "enabled", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTaxProfile_tenantId_companyId_code_key" ON "CompanyTaxProfile"("tenantId", "companyId", "code");

-- CreateIndex
CREATE INDEX "CompanyTaxProfileRate_tenantId_taxId_idx" ON "CompanyTaxProfileRate"("tenantId", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOffice_tenantId_companyId_id_key" ON "BusinessOffice"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Tax_tenantId_id_key" ON "Tax"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CompanyTaxRegistration" ADD CONSTRAINT "CompanyTaxRegistration_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "BusinessCompany"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxRegistrationRevision" ADD CONSTRAINT "CompanyTaxRegistrationRevision_tenantId_registrationId_fkey" FOREIGN KEY ("tenantId", "registrationId") REFERENCES "CompanyTaxRegistration"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeTaxRegistration" ADD CONSTRAINT "OfficeTaxRegistration_tenantId_companyId_officeId_fkey" FOREIGN KEY ("tenantId", "companyId", "officeId") REFERENCES "BusinessOffice"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeTaxRegistration" ADD CONSTRAINT "OfficeTaxRegistration_tenantId_companyId_registrationId_fkey" FOREIGN KEY ("tenantId", "companyId", "registrationId") REFERENCES "CompanyTaxRegistration"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxProfile" ADD CONSTRAINT "CompanyTaxProfile_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "BusinessCompany"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxProfileVersion" ADD CONSTRAINT "CompanyTaxProfileVersion_tenantId_profileId_fkey" FOREIGN KEY ("tenantId", "profileId") REFERENCES "CompanyTaxProfile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxProfileRate" ADD CONSTRAINT "CompanyTaxProfileRate_tenantId_profileId_profileVersion_fkey" FOREIGN KEY ("tenantId", "profileId", "profileVersion") REFERENCES "CompanyTaxProfileVersion"("tenantId", "profileId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTaxProfileRate" ADD CONSTRAINT "CompanyTaxProfileRate_tenantId_taxId_fkey" FOREIGN KEY ("tenantId", "taxId") REFERENCES "Tax"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION app.tax_configuration_admin(t text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.tenant_match(t) AND (current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM public."User" u JOIN public."Tenant" n ON n.id=u."tenantId" WHERE u."tenantId"=t AND u.id=coalesce(current_setting('app.actor_id',true),'') AND u.role='ADMIN' AND u.status='ACTIVE' AND n.status='ACTIVE'))
$$;
REVOKE ALL ON FUNCTION app.tax_configuration_admin(text) FROM PUBLIC;
CREATE FUNCTION app.tax_gstin_valid(v text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE alphabet text:='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';total integer:=0;product integer;i integer;
BEGIN
 IF v IS NULL OR v!~'^(0[1-9]|[12][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN RETURN false;END IF;
 FOR i IN REVERSE 14..1 LOOP product:=(strpos(alphabet,substr(v,i,1))-1)*CASE WHEN i%2=0 THEN 2 ELSE 1 END;total:=total+product/36+product%36;END LOOP;
 RETURN substr(alphabet,(36-total%36)%36+1,1)=right(v,1);
END $$;
ALTER TABLE "CompanyTaxRegistration" ADD CONSTRAINT registration_facts CHECK(scheme='IN_GST' AND "countryCode"='IN' AND app.tax_gstin_valid("registrationNumber") AND "regionCode"=left("registrationNumber",2) AND "postalCode"~'^[1-9][0-9]{5}$' AND length(trim(label)) BETWEEN 1 AND 100 AND length(trim("legalName")) BETWEEN 1 AND 200 AND length(trim("addressLine1")) BETWEEN 1 AND 300 AND length("addressLine2")<=300 AND length(trim(city)) BETWEEN 1 AND 100 AND category IN ('REGULAR','COMPOSITION','SEZ_UNIT','SEZ_DEVELOPER') AND "eInvoicePolicy" IN ('UNASSESSED','REQUIRED','NOT_REQUIRED') AND ("effectiveTo" IS NULL OR "effectiveTo">="effectiveFrom") AND version>0);
ALTER TABLE "CompanyTaxProfile" ADD CONSTRAINT profile_identity CHECK(scheme='IN_GST' AND code~'^[A-Z0-9][A-Z0-9_-]{0,39}$' AND length(trim(name)) BETWEEN 1 AND 150 AND version>0);
ALTER TABLE "CompanyTaxProfileRate" ADD CONSTRAINT profile_rate_facts CHECK("variantKey" IN ('INTRA_STATE','INTER_STATE') AND "componentCode" IN ('CGST','SGST','UTGST','IGST','CESS') AND percent BETWEEN 0 AND 100);

DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['CompanyTaxRegistration','CompanyTaxRegistrationRevision','OfficeTaxRegistration','CompanyTaxProfile','CompanyTaxProfileVersion','CompanyTaxProfileRate'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"))',t);
 EXECUTE format('CREATE POLICY tax_administration ON %I AS RESTRICTIVE FOR ALL USING(app.tax_configuration_admin("tenantId")) WITH CHECK(app.tax_configuration_admin("tenantId"))',t);
 IF t IN ('CompanyTaxRegistrationRevision','CompanyTaxProfileVersion','CompanyTaxProfileRate') THEN EXECUTE format('CREATE TRIGGER immutable_tax_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event()',t);END IF;
END LOOP;END $$;

CREATE FUNCTION app.tax_registration_snapshot(r public."CompanyTaxRegistration") RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',(r).id,'companyId',(r)."companyId",'scheme',(r).scheme,'countryCode',(r)."countryCode",'registrationNumber',(r)."registrationNumber",'regionCode',(r)."regionCode",'label',(r).label,'legalName',(r)."legalName",'addressLine1',(r)."addressLine1",'addressLine2',(r)."addressLine2",'city',(r).city,'postalCode',(r)."postalCode",'category',(r).category,'eInvoicePolicy',(r)."eInvoicePolicy",'effectiveFrom',(r)."effectiveFrom",'effectiveTo',(r)."effectiveTo",'archived',(r).archived,'version',(r).version)
$$;

CREATE FUNCTION app.tax_configuration_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE editable text[];active boolean;office_active boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax configuration history cannot be deleted' USING ERRCODE='23514';END IF;
 IF NOT app.tax_configuration_admin(NEW."tenantId") THEN RAISE EXCEPTION 'Tax configuration requires an active tenant administrator' USING ERRCODE='42501';END IF;
 SELECT NOT archived INTO active FROM public."BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND id=NEW."companyId" FOR UPDATE;
 IF active IS NULL THEN RAISE EXCEPTION 'Tax company unavailable' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='CompanyTaxRegistration' THEN
  editable:=ARRAY['label','legalName','addressLine1','addressLine2','city','postalCode','category','eInvoicePolicy','effectiveFrom','effectiveTo','archived','version','updatedAt'];
  IF NOT active AND NOT NEW.archived THEN RAISE EXCEPTION 'Restore the company before activating its registration' USING ERRCODE='23514';END IF;
  IF NEW.archived AND EXISTS(SELECT 1 FROM public."OfficeTaxRegistration" WHERE "tenantId"=NEW."tenantId" AND "registrationId"=NEW.id) THEN RAISE EXCEPTION 'Clear office mappings before archiving a registration' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='CompanyTaxProfile' THEN
  editable:=ARRAY['name','enabled','version','updatedAt'];
  IF NOT active AND NEW.enabled THEN RAISE EXCEPTION 'Restore the company before enabling its profile' USING ERRCODE='23514';END IF;
 ELSE
  editable:=ARRAY['registrationId','version','updatedAt'];
  SELECT NOT archived INTO office_active FROM public."BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."officeId" AND "companyId"=NEW."companyId" FOR SHARE;
  IF office_active IS NULL OR NEW."registrationId" IS NOT NULL AND (NOT active OR NOT office_active OR NOT EXISTS(SELECT 1 FROM public."CompanyTaxRegistration" WHERE "tenantId"=NEW."tenantId" AND id=NEW."registrationId" AND "companyId"=NEW."companyId" AND NOT archived)) THEN RAISE EXCEPTION 'Choose an active registration belonging to this office company' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP='INSERT' THEN IF NEW.version<>1 THEN RAISE EXCEPTION 'New tax configuration starts at version one' USING ERRCODE='23514';END IF;
 ELSIF NEW.version<>OLD.version+1 OR to_jsonb(NEW)-editable IS DISTINCT FROM to_jsonb(OLD)-editable THEN RAISE EXCEPTION 'Tax identity is immutable; use the current version for changes' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_configuration_write() FROM PUBLIC;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['CompanyTaxRegistration','OfficeTaxRegistration','CompanyTaxProfile'] LOOP EXECUTE format('CREATE TRIGGER tax_configuration_write BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.tax_configuration_write()',t);END LOOP;END $$;

CREATE FUNCTION app.tax_profile_shape(s jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE v jsonb;c jsonb;codes text[];base numeric;pair numeric;
BEGIN
 IF NOT coalesce(jsonb_typeof(s)='object' AND s->>'format'='1' AND s-ARRAY['format','name','scheme','enabled','supplyKind','treatment','classificationKind','classificationCode','basisReference','priceBasis','zeroRatedMode','variants']='{}'::jsonb AND octet_length(s::text)<=60000 AND s->>'scheme'='IN_GST' AND length(trim(s->>'name')) BETWEEN 1 AND 150 AND jsonb_typeof(s->'enabled')='boolean' AND s->>'supplyKind' IN ('GOODS','SERVICES','OTHER') AND s->>'treatment' IN ('TAXABLE','NIL_RATED','EXEMPT','ZERO_RATED','NON_GST') AND s->>'classificationKind' IN ('HSN','SAC','NONE') AND coalesce(s->>'classificationCode','')~'^[0-9]{0,12}$' AND s->>'priceBasis' IN ('INCLUSIVE','EXCLUSIVE') AND s->>'zeroRatedMode' IN ('NOT_APPLICABLE','WITH_PAYMENT','WITHOUT_PAYMENT') AND jsonb_typeof(s->'variants')='array' AND jsonb_array_length(s->'variants')<=2,false) THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['name','scheme','supplyKind','treatment','classificationKind','classificationCode','basisReference','priceBasis','zeroRatedMode']) k WHERE jsonb_typeof(s->k) IS DISTINCT FROM 'string') THEN RETURN false;END IF;
 IF s->>'classificationKind'='NONE' AND s->>'classificationCode'<>'' OR s->>'classificationKind'<>'NONE' AND (s->>'classificationCode')!~'^[0-9]{4,8}$' OR jsonb_typeof(s->'basisReference') IS DISTINCT FROM 'string' OR length(s->>'basisReference')>1000 OR s->>'treatment' IN ('EXEMPT','NON_GST') AND length(trim(s->>'basisReference'))=0 THEN RETURN false;END IF;
 IF (s->>'treatment'='ZERO_RATED')=(s->>'zeroRatedMode'='NOT_APPLICABLE') THEN RETURN false;END IF;
 IF (s->>'treatment'='TAXABLE' OR s->>'treatment'='ZERO_RATED' AND s->>'zeroRatedMode'='WITH_PAYMENT')<>(jsonb_array_length(s->'variants')>0) THEN RETURN false;END IF;
 IF (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(s->'variants') x)<>jsonb_array_length(s->'variants') THEN RETURN false;END IF;
 FOR v IN SELECT * FROM jsonb_array_elements(s->'variants') LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['key','components']<>'{}'::jsonb OR v->>'key' NOT IN ('INTRA_STATE','INTER_STATE') OR jsonb_typeof(v->'components') IS DISTINCT FROM 'array' OR jsonb_array_length(v->'components') NOT BETWEEN 1 AND 3 THEN RETURN false;END IF;
  SELECT array_agg(x->>'code') INTO codes FROM jsonb_array_elements(v->'components') x;
  IF cardinality(codes)<>(SELECT count(DISTINCT x) FROM unnest(codes) x) THEN RETURN false;END IF;
  IF v->>'key'='INTER_STATE' THEN IF NOT 'IGST'=ANY(codes) OR NOT codes<@ARRAY['IGST','CESS'] THEN RETURN false;END IF;
  ELSE IF NOT 'CGST'=ANY(codes) OR ('SGST'=ANY(codes))=('UTGST'=ANY(codes)) OR NOT codes<@ARRAY['CGST','SGST','UTGST','CESS'] THEN RETURN false;END IF;END IF;
  IF s->>'treatment'='ZERO_RATED' AND v->>'key'<>'INTER_STATE' THEN RETURN false;END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(v->'components') LOOP IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c-ARRAY['code','rateId','name','percent','sourceUpdatedAt']<>'{}'::jsonb OR EXISTS(SELECT 1 FROM unnest(ARRAY['code','rateId','name','percent','sourceUpdatedAt']) k WHERE jsonb_typeof(c->k) IS DISTINCT FROM 'string') OR coalesce(c->>'percent','')!~'^[0-9]{1,3}(\.[0-9]{1,12})?$' OR (c->>'percent')::numeric>100 OR length(coalesce(c->>'rateId','')) NOT BETWEEN 1 AND 200 OR length(coalesce(c->>'name','')) NOT BETWEEN 1 AND 200 THEN RETURN false;END IF;END LOOP;
  IF (s->>'enabled')::boolean THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(v->'components') x WHERE x->>'code'<>'CESS' AND (x->>'percent')::numeric<=0) THEN RETURN false;END IF;
   SELECT sum((x->>'percent')::numeric) INTO base FROM jsonb_array_elements(v->'components') x WHERE x->>'code'<>'CESS';IF base>100 THEN RETURN false;END IF;
   IF v->>'key'='INTRA_STATE' THEN SELECT (x->>'percent')::numeric INTO pair FROM jsonb_array_elements(v->'components') x WHERE x->>'code'='CGST';IF base<>pair*2 THEN RETURN false;END IF;END IF;
  END IF;
 END LOOP;RETURN true;
END $$;
ALTER TABLE "CompanyTaxProfileVersion" ADD CONSTRAINT profile_snapshot_shape CHECK(app.tax_profile_shape(snapshot));

CREATE FUNCTION app.tax_revision_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r public."CompanyTaxRegistration"%ROWTYPE;p public."CompanyTaxProfile"%ROWTYPE;t public."Tax"%ROWTYPE;
BEGIN
 IF NOT app.tax_configuration_admin(NEW."tenantId") THEN RAISE EXCEPTION 'Tax review requires tenant administrator authority' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME<>'CompanyTaxProfileRate' AND current_setting('app.rls_bypass',true)<>'on' AND to_jsonb(NEW)->>'actorId' IS DISTINCT FROM current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Tax review actor mismatch' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='CompanyTaxRegistrationRevision' THEN
  SELECT * INTO r FROM public."CompanyTaxRegistration" WHERE "tenantId"=NEW."tenantId" AND id=NEW."registrationId";
  IF r.version IS DISTINCT FROM NEW.version OR NEW.snapshot IS DISTINCT FROM app.tax_registration_snapshot(r) THEN RAISE EXCEPTION 'Registration revision must freeze the current facts' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO p FROM public."CompanyTaxProfile" WHERE "tenantId"=NEW."tenantId" AND id=NEW."profileId";
  IF TG_TABLE_NAME='CompanyTaxProfileVersion' THEN
   IF p.version IS DISTINCT FROM NEW.version OR NEW.snapshot->>'name' IS DISTINCT FROM p.name OR (NEW.snapshot->>'enabled')::boolean IS DISTINCT FROM p.enabled OR NEW.snapshot->>'scheme' IS DISTINCT FROM p.scheme THEN RAISE EXCEPTION 'Tax profile version must freeze its current identity' USING ERRCODE='23514';END IF;
  ELSE
   SELECT * INTO t FROM public."Tax" WHERE "tenantId"=NEW."tenantId" AND id=NEW."taxId" FOR SHARE;
   IF p.version IS DISTINCT FROM NEW."profileVersion" OR t.id IS NULL OR p.enabled AND NOT t."isActive" OR NEW.percent IS DISTINCT FROM t.percent::text::numeric OR NEW.name IS DISTINCT FROM t.name OR NEW."sourceUpdatedAt" IS DISTINCT FROM t."updatedAt" THEN RAISE EXCEPTION 'Freeze current rate facts when publishing a profile version' USING ERRCODE='23514';END IF;
  END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_revision_write() FROM PUBLIC;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['CompanyTaxRegistrationRevision','CompanyTaxProfileVersion','CompanyTaxProfileRate'] LOOP EXECUTE format('CREATE TRIGGER tax_revision_write BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app.tax_revision_write()',t);END LOOP;END $$;

CREATE FUNCTION app.tax_configuration_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r public."CompanyTaxRegistration"%ROWTYPE;p public."CompanyTaxProfile"%ROWTYPE;s jsonb;v jsonb;c jsonb;key text;total integer:=0;
BEGIN
 IF TG_TABLE_NAME IN ('CompanyTaxRegistration','CompanyTaxRegistrationRevision') THEN
  key:=to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='CompanyTaxRegistration' THEN 'id' ELSE 'registrationId' END);
  SELECT * INTO r FROM public."CompanyTaxRegistration" WHERE "tenantId"=NEW."tenantId" AND id=key;
  IF NOT EXISTS(SELECT 1 FROM public."CompanyTaxRegistrationRevision" x WHERE x."tenantId"=r."tenantId" AND x."registrationId"=r.id AND x.version=r.version AND x.snapshot=app.tax_registration_snapshot(r)) THEN RAISE EXCEPTION 'Registration update requires immutable reviewed history' USING ERRCODE='23514';END IF;
 ELSE
  key:=to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='CompanyTaxProfile' THEN 'id' ELSE 'profileId' END);
  SELECT * INTO p FROM public."CompanyTaxProfile" WHERE "tenantId"=NEW."tenantId" AND id=key;
  SELECT snapshot INTO s FROM public."CompanyTaxProfileVersion" WHERE "tenantId"=p."tenantId" AND "profileId"=p.id AND version=p.version;
  IF s IS NULL OR s->>'name' IS DISTINCT FROM p.name OR (s->>'enabled')::boolean IS DISTINCT FROM p.enabled THEN RAISE EXCEPTION 'Tax profile update requires immutable reviewed history' USING ERRCODE='23514';END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(s->'variants') LOOP FOR c IN SELECT * FROM jsonb_array_elements(v->'components') LOOP
   total:=total+1;IF NOT EXISTS(SELECT 1 FROM public."CompanyTaxProfileRate" x WHERE x."tenantId"=p."tenantId" AND x."profileId"=p.id AND x."profileVersion"=p.version AND x."variantKey"=v->>'key' AND x."componentCode"=c->>'code' AND x."taxId"=c->>'rateId' AND x.name=c->>'name' AND x.percent=(c->>'percent')::numeric AND x."sourceUpdatedAt"=(c->>'sourceUpdatedAt')::timestamptz AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Tax profile components must match reviewed rate facts' USING ERRCODE='23514';END IF;
  END LOOP;END LOOP;
  IF total<>(SELECT count(*) FROM public."CompanyTaxProfileRate" x WHERE x."tenantId"=p."tenantId" AND x."profileId"=p.id AND x."profileVersion"=p.version) THEN RAISE EXCEPTION 'Tax profile component count mismatch' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_configuration_proof() FROM PUBLIC;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['CompanyTaxRegistration','CompanyTaxRegistrationRevision','CompanyTaxProfile','CompanyTaxProfileVersion','CompanyTaxProfileRate'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER tax_configuration_proof AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.tax_configuration_proof()',t);END LOOP;END $$;
DO $$ DECLARE who text;BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON "CompanyTaxRegistration","OfficeTaxRegistration","CompanyTaxProfile" TO %I',who);
 EXECUTE format('GRANT SELECT,INSERT ON "CompanyTaxRegistrationRevision","CompanyTaxProfileVersion","CompanyTaxProfileRate" TO %I',who);
 EXECUTE format('GRANT EXECUTE ON FUNCTION app.tax_configuration_admin(text) TO %I',who);
 END IF;END LOOP;END $$;
-- No registrations, rates, profiles, grants, bindings or invoice facts are inferred.
COMMIT;
