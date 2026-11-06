BEGIN;
CREATE TABLE "PartyAddress" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "contactId" text, "accountId" text, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 purposes text[] NOT NULL CHECK(cardinality(purposes) BETWEEN 1 AND 3 AND purposes <@ ARRAY['CORRESPONDENCE','BILLING','DELIVERY']::text[]),
 "values" jsonb NOT NULL CHECK(jsonb_typeof("values")='object'),
 "defaultCorrespondence" boolean NOT NULL DEFAULT false, "defaultBilling" boolean NOT NULL DEFAULT false, "defaultDelivery" boolean NOT NULL DEFAULT false,
 archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 CHECK(("contactId" IS NOT NULL)::int+("accountId" IS NOT NULL)::int=1),
 CHECK(NOT "defaultCorrespondence" OR (NOT archived AND 'CORRESPONDENCE'=ANY(purposes))),
 CHECK(NOT "defaultBilling" OR (NOT archived AND 'BILLING'=ANY(purposes))),
 CHECK(NOT "defaultDelivery" OR (NOT archived AND 'DELIVERY'=ANY(purposes))),
 FOREIGN KEY("tenantId","contactId") REFERENCES "CrmContact"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","accountId") REFERENCES "CrmAccount"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PartyAddress_tenantId_id_key" ON "PartyAddress"("tenantId",id);
CREATE INDEX "PartyAddress_contact_active" ON "PartyAddress"("tenantId","contactId",archived);
CREATE INDEX "PartyAddress_account_active" ON "PartyAddress"("tenantId","accountId",archived);
CREATE UNIQUE INDEX "PartyAddress_contact_name" ON "PartyAddress"("tenantId","contactId",lower(name)) WHERE "contactId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_account_name" ON "PartyAddress"("tenantId","accountId",lower(name)) WHERE "accountId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_contact_correspondence" ON "PartyAddress"("tenantId","contactId") WHERE "defaultCorrespondence" AND "contactId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_account_correspondence" ON "PartyAddress"("tenantId","accountId") WHERE "defaultCorrespondence" AND "accountId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_contact_billing" ON "PartyAddress"("tenantId","contactId") WHERE "defaultBilling" AND "contactId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_account_billing" ON "PartyAddress"("tenantId","accountId") WHERE "defaultBilling" AND "accountId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_contact_delivery" ON "PartyAddress"("tenantId","contactId") WHERE "defaultDelivery" AND "contactId" IS NOT NULL;
CREATE UNIQUE INDEX "PartyAddress_account_delivery" ON "PartyAddress"("tenantId","accountId") WHERE "defaultDelivery" AND "accountId" IS NOT NULL;
CREATE FUNCTION app.party_address_owner_visible(t text,c text,b text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "CrmContact" WHERE "tenantId"=t AND id=c) OR EXISTS(SELECT 1 FROM "CrmAccount" WHERE "tenantId"=t AND id=b)
$$;
CREATE FUNCTION app.party_address_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_archived boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive addresses instead of deleting them' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."tenantId",NEW."contactId",NEW."accountId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."contactId",OLD."accountId",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Address ownership is immutable; increment its version' USING ERRCODE='23514'; END IF;
 ELSIF NEW.version<>1 OR NEW.archived THEN RAISE EXCEPTION 'Create an active initial address' USING ERRCODE='23514'; END IF;
 IF NEW."contactId" IS NOT NULL THEN SELECT archived INTO parent_archived FROM "CrmContact" WHERE "tenantId"=NEW."tenantId" AND id=NEW."contactId" FOR UPDATE;
 ELSE SELECT archived INTO parent_archived FROM "CrmAccount" WHERE "tenantId"=NEW."tenantId" AND id=NEW."accountId" FOR UPDATE; END IF;
 IF parent_archived IS NULL OR parent_archived AND NOT NEW.archived THEN RAISE EXCEPTION 'Choose an active readable address owner' USING ERRCODE='23514'; END IF;
 IF cardinality(NEW.purposes)<>(SELECT count(DISTINCT p) FROM unnest(NEW.purposes) p) THEN RAISE EXCEPTION 'Address purposes must be unique' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_address_write BEFORE INSERT OR UPDATE OR DELETE ON "PartyAddress" FOR EACH ROW EXECUTE FUNCTION app.party_address_write();
ALTER TABLE "PartyAddress" ENABLE ROW LEVEL SECURITY; ALTER TABLE "PartyAddress" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PartyAddress" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY owner_read ON "PartyAddress" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.party_address_owner_visible("tenantId","contactId","accountId"));
CREATE POLICY owner_insert ON "PartyAddress" AS RESTRICTIVE FOR INSERT WITH CHECK(app.record_sharing_allowed("tenantId",CASE WHEN "contactId" IS NOT NULL THEN 'contacts' ELSE 'accounts' END,coalesce("contactId","accountId"),nullif(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY owner_update ON "PartyAddress" AS RESTRICTIVE FOR UPDATE USING(app.record_sharing_allowed("tenantId",CASE WHEN "contactId" IS NOT NULL THEN 'contacts' ELSE 'accounts' END,coalesce("contactId","accountId"),nullif(current_setting('app.actor_id',true),''),'EDIT'));
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON "PartyAddress" TO %I',who); END IF; END LOOP; END $$;
COMMIT;
