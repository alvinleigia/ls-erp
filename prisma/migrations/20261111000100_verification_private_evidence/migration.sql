BEGIN;
CREATE TABLE "VerificationEvidence" (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9-]{36}$'), "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseId" text NOT NULL, "policyVersion" integer NOT NULL, "documentCode" text NOT NULL CHECK("documentCode" ~ '^[a-z][a-z0-9_]{0,39}$'),
 filename text NOT NULL CHECK(length(btrim(filename)) BETWEEN 1 AND 120 AND filename !~ '[[:cntrl:]/\\"]'),
 "contentType" text NOT NULL CHECK("contentType" IN ('application/pdf','image/jpeg','image/png')), bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
 path text NOT NULL UNIQUE, state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','ABANDONED')),
 sha256 text, "uploadedByUserId" text NOT NULL, "finalizedByUserId" text,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" timestamp(3) NOT NULL, "readyAt" timestamp(3), "cleanedAt" timestamp(3), "failureCode" text,
 UNIQUE("tenantId",id),
 FOREIGN KEY("tenantId","caseId") REFERENCES "CustomerVerificationCase"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","policyVersion") REFERENCES "VerificationPolicyVersion"("tenantId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","uploadedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","finalizedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(path="tenantId"||'/cases/'||"caseId"||'/'||id||CASE "contentType" WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' ELSE '.jpg' END),
 CHECK((state='READY' AND sha256 IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND "readyAt" IS NOT NULL AND "finalizedByUserId" IS NOT NULL AND "cleanedAt" IS NULL AND "failureCode" IS NULL) OR (state<>'READY' AND sha256 IS NULL AND "readyAt" IS NULL AND "finalizedByUserId" IS NULL)),
 CHECK((state='ABANDONED' AND "failureCode" IS NOT NULL AND "failureCode" IN ('CANCELLED','INVALID_FILE','EXPIRED')) OR (state<>'ABANDONED' AND "failureCode" IS NULL)),
 CHECK("cleanedAt" IS NULL OR state='ABANDONED')
);
CREATE INDEX "VerificationEvidence_tenantId_caseId_state_idx" ON "VerificationEvidence"("tenantId","caseId",state);
CREATE INDEX "VerificationEvidence_tenantId_state_expiresAt_idx" ON "VerificationEvidence"("tenantId",state,"expiresAt");

CREATE OR REPLACE FUNCTION app.verification_permission_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE COALESCE(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
 AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND u."collaboratorId" IS NULL
 AND p IN ('verificationPolicies.read','verificationPolicies.edit','customerVerification.read','customerVerification.create','contacts.read','accounts.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel','verificationEvidence.read')
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='crm' AND m.allowed AND m.enabled)
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='customerVerification' AND m.allowed AND m.enabled)
 AND (u.role='ADMIN' OR (
 EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions))
 AND COALESCE(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
$$;
-- Requirements projection for collectors; no policy administration grant needed.
CREATE FUNCTION app.verification_collection_policy(t text,k text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('version',version,'documents',coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(definition->'documents') d WHERE d->'subjects' ? k),'[]'::jsonb))
 FROM public."VerificationPolicyVersion" WHERE "tenantId"=t AND app.verification_permission_scope(t,'customerVerification.read')='ALL' AND k IN ('PERSON','BUSINESS') ORDER BY version DESC LIMIT 1
$$;
CREATE FUNCTION app.verification_evidence_capacity(t text,k text) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND app.verification_permission_scope(t,'verificationUploads.create')='ALL'
 AND (SELECT count(*) FROM public."VerificationEvidence" WHERE "tenantId"=t AND "caseId"=k AND "cleanedAt" IS NULL)<20
 AND (SELECT count(*) FROM public."VerificationEvidence" WHERE "tenantId"=t AND state<>'READY' AND "cleanedAt" IS NULL)<100
$$;
CREATE FUNCTION app.verification_evidence_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text:=nullif(current_setting('app.actor_id',true),''); c "CustomerVerificationCase"%ROWTYPE; policy jsonb; admin_actor boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain verification evidence history' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 SELECT * INTO c FROM "CustomerVerificationCase" WHERE "tenantId"=NEW."tenantId" AND id=NEW."caseId";
 IF c.id IS NULL THEN RAISE EXCEPTION 'Verification case is not accessible' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM "User" WHERE "tenantId"=NEW."tenantId" AND id=uid AND role='ADMIN' AND "collaboratorId" IS NULL AND status='ACTIVE') INTO admin_actor;
 IF TG_OP='INSERT' THEN
  IF app.verification_permission_scope(NEW."tenantId",'verificationUploads.create') IS DISTINCT FROM 'ALL' OR NEW."uploadedByUserId" IS DISTINCT FROM uid OR NEW.state<>'PENDING' OR NEW."cleanedAt" IS NOT NULL OR NOT coalesce(app.verification_evidence_capacity(NEW."tenantId",NEW."caseId"),false) THEN RAISE EXCEPTION 'Private upload is not permitted or its limit has been reached' USING ERRCODE='42501'; END IF;
  NEW."createdAt":=statement_timestamp(); NEW."expiresAt":=NEW."createdAt"+interval '3 hours';
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."caseId",NEW."policyVersion",NEW."documentCode",NEW.filename,NEW."contentType",NEW.bytes,NEW.path,NEW."uploadedByUserId",NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."caseId",OLD."policyVersion",OLD."documentCode",OLD.filename,OLD."contentType",OLD.bytes,OLD.path,OLD."uploadedByUserId",OLD."createdAt",OLD."expiresAt") OR OLD.state='READY' OR OLD."cleanedAt" IS NOT NULL THEN RAISE EXCEPTION 'Evidence identity and accepted files are immutable' USING ERRCODE='23514'; END IF;
  IF NEW."cleanedAt" IS NOT NULL THEN
   IF NOT admin_actor OR app.verification_permission_scope(NEW."tenantId",'verificationUploads.cancel') IS DISTINCT FROM 'ALL' OR OLD."expiresAt">statement_timestamp() OR NEW.state<>'ABANDONED' OR NEW."failureCode"<>'EXPIRED' THEN RAISE EXCEPTION 'Only expired unaccepted uploads can be cleaned' USING ERRCODE='42501'; END IF;
   NEW."cleanedAt":=statement_timestamp(); RETURN NEW;
  END IF;
  IF NEW.state='ABANDONED' AND NEW."failureCode"='EXPIRED' THEN
   IF NOT admin_actor OR app.verification_permission_scope(NEW."tenantId",'verificationUploads.cancel') IS DISTINCT FROM 'ALL' OR OLD."expiresAt">statement_timestamp() THEN RAISE EXCEPTION 'Only expired unaccepted uploads can be expired for cleanup' USING ERRCODE='42501'; END IF;
   RETURN NEW;
  END IF;
  IF NOT (admin_actor OR OLD."uploadedByUserId"=uid) OR OLD.state<>'PENDING' THEN RAISE EXCEPTION 'This upload cannot be changed' USING ERRCODE='42501'; END IF;
  IF NEW.state='ABANDONED' THEN
   IF app.verification_permission_scope(NEW."tenantId",'verificationUploads.cancel') IS DISTINCT FROM 'ALL' AND app.verification_permission_scope(NEW."tenantId",'verificationUploads.create') IS DISTINCT FROM 'ALL' THEN RAISE EXCEPTION 'Upload cancellation is not permitted' USING ERRCODE='42501'; END IF;
   RETURN NEW;
  END IF;
  IF NEW.state<>'READY' OR app.verification_permission_scope(NEW."tenantId",'verificationUploads.create') IS DISTINCT FROM 'ALL' OR OLD."expiresAt"<=statement_timestamp() OR NEW."finalizedByUserId" IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Upload finalisation is not permitted' USING ERRCODE='42501'; END IF;
  NEW."readyAt":=statement_timestamp();
 END IF;
 policy:=app.verification_collection_policy(NEW."tenantId",CASE WHEN c."contactId" IS NOT NULL THEN 'PERSON' ELSE 'BUSINESS' END);
 IF policy IS NULL OR NEW."policyVersion"<>(policy->>'version')::integer OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'documents') d WHERE d->>'code'=NEW."documentCode") OR EXISTS(SELECT 1 FROM "CrmContact" WHERE "tenantId"=NEW."tenantId" AND id=c."contactId" AND archived) OR EXISTS(SELECT 1 FROM "CrmAccount" WHERE "tenantId"=NEW."tenantId" AND id=c."accountId" AND archived) THEN RAISE EXCEPTION 'Choose a current document requirement and active customer' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verification_evidence_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationEvidence" FOR EACH ROW EXECUTE FUNCTION app.verification_evidence_write();
ALTER TABLE "VerificationEvidence" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationEvidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_read ON "VerificationEvidence" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM "CustomerVerificationCase" c WHERE c."tenantId"="VerificationEvidence"."tenantId" AND c.id="caseId" AND ((state='READY' AND app.verification_permission_scope("VerificationEvidence"."tenantId",'verificationEvidence.read')='ALL') OR (app.verification_permission_scope("VerificationEvidence"."tenantId",'verificationUploads.read')='ALL' AND ("uploadedByUserId"=nullif(current_setting('app.actor_id',true),'') OR EXISTS(SELECT 1 FROM "User" WHERE id=nullif(current_setting('app.actor_id',true),'') AND "tenantId"="VerificationEvidence"."tenantId" AND role='ADMIN')))))));
CREATE POLICY evidence_insert ON "VerificationEvidence" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationUploads.create')='ALL' AND EXISTS(SELECT 1 FROM "CustomerVerificationCase" c WHERE c."tenantId"="VerificationEvidence"."tenantId" AND c.id="caseId"));
CREATE POLICY evidence_update ON "VerificationEvidence" FOR UPDATE USING(app.tenant_match("tenantId") AND (app.verification_permission_scope("tenantId",'verificationUploads.create')='ALL' OR app.verification_permission_scope("tenantId",'verificationUploads.cancel')='ALL')) WITH CHECK(app.tenant_match("tenantId"));
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON "VerificationEvidence" TO %I',who); END IF; END LOOP; END $$;
COMMIT;
