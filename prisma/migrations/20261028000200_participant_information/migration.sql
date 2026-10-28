BEGIN;

ALTER TABLE "CrmOpportunity" ADD COLUMN "participantInformation" jsonb;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT participant_information_object CHECK ("participantInformation" IS NULL OR jsonb_typeof("participantInformation")='object');
ALTER TABLE "SalesOrder" ADD COLUMN "participantAcceptance" jsonb;
ALTER TABLE "SalesOrder" ADD CONSTRAINT participant_acceptance_object CHECK ("participantAcceptance" IS NULL OR jsonb_typeof("participantAcceptance")='object');

CREATE TABLE "ParticipantFormConfiguration" (
 "tenantId" text PRIMARY KEY REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object'),
 "updatedAt" timestamp(3) NOT NULL
);
ALTER TABLE "ParticipantFormConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParticipantFormConfiguration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ParticipantFormConfiguration" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
CREATE POLICY configuration_insert ON "ParticipantFormConfiguration" AS RESTRICTIVE FOR INSERT WITH CHECK (
 current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM "User" WHERE "tenantId"="ParticipantFormConfiguration"."tenantId" AND id=nullif(current_setting('app.actor_id',true),'') AND role='ADMIN' AND status='ACTIVE')
);
CREATE POLICY configuration_update ON "ParticipantFormConfiguration" AS RESTRICTIVE FOR UPDATE USING (
 current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM "User" WHERE "tenantId"="ParticipantFormConfiguration"."tenantId" AND id=nullif(current_setting('app.actor_id',true),'') AND role='ADMIN' AND status='ACTIVE')
);
CREATE POLICY configuration_delete ON "ParticipantFormConfiguration" AS RESTRICTIVE FOR DELETE USING (false);

CREATE FUNCTION app.participant_configuration_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ((NEW."tenantId" IS DISTINCT FROM OLD."tenantId") OR NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION 'Customer detail configuration requires the next version and immutable tenant identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER participant_configuration_version BEFORE UPDATE ON "ParticipantFormConfiguration" FOR EACH ROW EXECUTE FUNCTION app.participant_configuration_version();

CREATE FUNCTION app.participant_acceptance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."participantAcceptance" IS NOT NULL THEN RAISE EXCEPTION 'Customer detail acceptance is recorded only at confirmation' USING ERRCODE='23514'; END IF;
 ELSIF NEW."participantAcceptance" IS DISTINCT FROM OLD."participantAcceptance" AND NOT (OLD.status='DRAFT' AND NEW.status='CONFIRMED' AND OLD."participantAcceptance" IS NULL AND NEW."participantAcceptance" IS NOT NULL) THEN
  RAISE EXCEPTION 'Confirmed customer detail acceptance is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER participant_acceptance_immutable BEFORE INSERT OR UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.participant_acceptance_immutable();

-- Keep the original source/snapshot/version/transition guard. The new evidence
-- column has its own stricter one-time confirmation guard above.
CREATE OR REPLACE FUNCTION app.preserve_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['sharingPolicyId','updatedAt'])=(to_jsonb(NEW)-ARRAY['sharingPolicyId','updatedAt']) THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Sales orders must start as drafts'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(OLD)-'status'-'version'-'updatedAt'-'participantAcceptance')=(to_jsonb(NEW)-'status'-'version'-'updatedAt'-'participantAcceptance')
   AND NEW.version=OLD.version+1
   AND ((OLD.status='DRAFT' AND NEW.status IN ('CONFIRMED','CANCELLED')) OR (OLD.status='CONFIRMED' AND NEW.status='CANCELLED')) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Sales order snapshot is immutable or transition is invalid';
END; $$;

DO $$ DECLARE who text; BEGIN
 FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON "ParticipantFormConfiguration" TO %I',who); END IF;
 END LOOP;
END $$;

-- Existing root policies, frozen revisions and effective profile rules are
-- untouched. New fields stay NULL; no tenant gets mandatory fields by default.
COMMIT;
