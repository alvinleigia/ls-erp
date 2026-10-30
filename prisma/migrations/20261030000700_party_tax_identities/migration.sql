BEGIN;
CREATE TABLE "PartyTaxIdentity" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "contactId" text, "accountId" text, scheme text NOT NULL CHECK(scheme='IN_GST'), "countryCode" text NOT NULL CHECK("countryCode"='IN'),
 status text NOT NULL CHECK(status IN ('REGISTERED','UNREGISTERED')), "registrationNumber" text NOT NULL,
 "regionCode" text NOT NULL CHECK("regionCode"='' OR "regionCode" ~ '^(0[1-9]|[12][0-9]|3[0-8]|97)$'),
 category text NOT NULL CHECK(category IN ('REGULAR','COMPOSITION','SEZ_UNIT','SEZ_DEVELOPER','NOT_APPLICABLE')),
 "legalName" text NOT NULL CHECK(length(btrim("legalName")) BETWEEN 1 AND 200), "addressLine1" text NOT NULL, "addressLine2" text NOT NULL, city text NOT NULL,
 "postalCode" text NOT NULL CHECK("postalCode"='' OR "postalCode" ~ '^[1-9][0-9]{5}$'),
 "effectiveFrom" date NOT NULL, "effectiveTo" date, archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 CHECK(("contactId" IS NOT NULL)::int+("accountId" IS NOT NULL)::int=1), CHECK("effectiveTo" IS NULL OR "effectiveTo">="effectiveFrom"),
 CHECK((status='REGISTERED' AND app.tax_gstin_valid("registrationNumber") AND "regionCode"=left("registrationNumber",2) AND category<>'NOT_APPLICABLE') OR (status='UNREGISTERED' AND "registrationNumber"='' AND category='NOT_APPLICABLE')),
 FOREIGN KEY("tenantId","contactId") REFERENCES "CrmContact"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","accountId") REFERENCES "CrmAccount"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PartyTaxIdentity_tenantId_id_key" ON "PartyTaxIdentity"("tenantId",id);
CREATE UNIQUE INDEX "PartyTaxIdentity_tenantId_contactId_scheme_registrationNumber_key" ON "PartyTaxIdentity"("tenantId","contactId",scheme,"registrationNumber");
CREATE UNIQUE INDEX "PartyTaxIdentity_tenantId_accountId_scheme_registrationNumber_key" ON "PartyTaxIdentity"("tenantId","accountId",scheme,"registrationNumber");
CREATE TABLE "PartyTaxIdentityRevision" (
 id text PRIMARY KEY, "tenantId" text NOT NULL, "identityId" text NOT NULL, version integer NOT NULL CHECK(version>0), snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), "actorId" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","identityId") REFERENCES "PartyTaxIdentity"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","actorId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PartyTaxIdentityRevision_tenantId_identityId_version_key" ON "PartyTaxIdentityRevision"("tenantId","identityId",version);

CREATE FUNCTION app.party_tax_snapshot(r public."PartyTaxIdentity") RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('format',1)||(to_jsonb(r)-'createdAt'-'updatedAt') $$;
-- INVOKER: the owner lookup retains the existing canonical record's RLS.
CREATE FUNCTION app.party_tax_owner_visible(t text,c text,b text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "CrmContact" WHERE "tenantId"=t AND id=c) OR EXISTS(SELECT 1 FROM "CrmAccount" WHERE "tenantId"=t AND id=b)
$$;
CREATE FUNCTION app.party_tax_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_archived boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive tax identities; history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."tenantId",NEW."contactId",NEW."accountId",NEW.scheme,NEW."countryCode",NEW.status,NEW."registrationNumber",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."contactId",OLD."accountId",OLD.scheme,OLD."countryCode",OLD.status,OLD."registrationNumber",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Tax identity ownership/identity is immutable; increment its review version' USING ERRCODE='23514'; END IF;
 ELSE IF NEW.version<>1 OR NEW.archived THEN RAISE EXCEPTION 'Create an active initial tax identity review' USING ERRCODE='23514'; END IF; END IF;
 -- All identities on one party serialize on its canonical owner, including
 -- concurrent registered/unregistered creates and restoration of archived rows.
 IF NEW."contactId" IS NOT NULL THEN SELECT archived INTO parent_archived FROM "CrmContact" WHERE "tenantId"=NEW."tenantId" AND id=NEW."contactId" FOR UPDATE;
 ELSE SELECT archived INTO parent_archived FROM "CrmAccount" WHERE "tenantId"=NEW."tenantId" AND id=NEW."accountId" FOR UPDATE; END IF;
 IF parent_archived IS NULL OR parent_archived AND NOT NEW.archived THEN RAISE EXCEPTION 'Choose an active readable tax identity owner' USING ERRCODE='23514'; END IF;
 IF NOT NEW.archived AND EXISTS(SELECT 1 FROM "PartyTaxIdentity" p WHERE p."tenantId"=NEW."tenantId" AND p.id<>NEW.id AND p."contactId" IS NOT DISTINCT FROM NEW."contactId" AND p."accountId" IS NOT DISTINCT FROM NEW."accountId" AND p.scheme=NEW.scheme AND NOT p.archived AND (p.status='UNREGISTERED' OR NEW.status='UNREGISTERED')) THEN
  RAISE EXCEPTION 'Archive conflicting tax status before recording a different assessment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_tax_write BEFORE INSERT OR UPDATE OR DELETE ON "PartyTaxIdentity" FOR EACH ROW EXECUTE FUNCTION app.party_tax_write();
CREATE FUNCTION app.party_tax_revision_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Tax identity history is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "PartyTaxIdentity" p WHERE p."tenantId"=NEW."tenantId" AND p.id=NEW."identityId" AND p.version=NEW.version AND app.party_tax_snapshot(p)=NEW.snapshot) OR (current_setting('app.rls_bypass',true) IS DISTINCT FROM 'on' AND NEW."actorId" IS DISTINCT FROM current_setting('app.actor_id',true)) THEN RAISE EXCEPTION 'Tax identity history must match its current reviewed facts and actor' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_tax_revision_write BEFORE INSERT OR UPDATE OR DELETE ON "PartyTaxIdentityRevision" FOR EACH ROW EXECUTE FUNCTION app.party_tax_revision_write();
CREATE FUNCTION app.party_tax_review_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "PartyTaxIdentityRevision" r WHERE r."tenantId"=NEW."tenantId" AND r."identityId"=NEW.id AND r.version=NEW.version AND r.snapshot=app.party_tax_snapshot(NEW)) THEN RAISE EXCEPTION 'Every tax identity version requires immutable reviewed history' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER party_tax_review_proof AFTER INSERT OR UPDATE ON "PartyTaxIdentity" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.party_tax_review_proof();
ALTER TABLE "PartyTaxIdentity" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PartyTaxIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PartyTaxIdentityRevision" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PartyTaxIdentityRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PartyTaxIdentity" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY owner_read ON "PartyTaxIdentity" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.party_tax_owner_visible("tenantId","contactId","accountId"));
CREATE POLICY owner_insert ON "PartyTaxIdentity" AS RESTRICTIVE FOR INSERT WITH CHECK(app.record_sharing_allowed("tenantId",CASE WHEN "contactId" IS NOT NULL THEN 'contacts' ELSE 'accounts' END,coalesce("contactId","accountId"),nullif(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY owner_update ON "PartyTaxIdentity" AS RESTRICTIVE FOR UPDATE USING(app.record_sharing_allowed("tenantId",CASE WHEN "contactId" IS NOT NULL THEN 'contacts' ELSE 'accounts' END,coalesce("contactId","accountId"),nullif(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY tenant_isolation ON "PartyTaxIdentityRevision" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY owner_read ON "PartyTaxIdentityRevision" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM "PartyTaxIdentity" p WHERE p."tenantId"="PartyTaxIdentityRevision"."tenantId" AND p.id="PartyTaxIdentityRevision"."identityId"));
CREATE POLICY owner_insert ON "PartyTaxIdentityRevision" AS RESTRICTIVE FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM "PartyTaxIdentity" p WHERE p."tenantId"="PartyTaxIdentityRevision"."tenantId" AND p.id="PartyTaxIdentityRevision"."identityId" AND app.record_sharing_allowed(p."tenantId",CASE WHEN p."contactId" IS NOT NULL THEN 'contacts' ELSE 'accounts' END,coalesce(p."contactId",p."accountId"),nullif(current_setting('app.actor_id',true),''),'EDIT')));
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON "PartyTaxIdentity","PartyTaxIdentityRevision" TO %I',who);END IF;END LOOP; END $$;
COMMIT;
