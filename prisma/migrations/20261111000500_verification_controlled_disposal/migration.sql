BEGIN;
CREATE OR REPLACE FUNCTION app.verification_permission_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE COALESCE(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
 AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND u."collaboratorId" IS NULL
 AND p IN ('verificationPolicies.read','verificationPolicies.edit','customerVerification.read','customerVerification.create','contacts.read','accounts.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel','verificationEvidence.read','verificationSubmissions.read','verificationSubmissions.create','verificationReviews.read','verificationReviews.approve','verificationReviews.cancel','verificationRetention.read','verificationRetention.edit','verificationHolds.read','verificationHolds.create','verificationHolds.cancel','verificationDisposals.read','verificationDisposals.create','verificationDisposals.approve','verificationDisposals.cancel')
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='crm' AND m.allowed AND m.enabled)
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='customerVerification' AND m.allowed AND m.enabled)
 AND (u.role='ADMIN' OR (
 EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions))
 AND COALESCE(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
  $$;
CREATE TABLE "VerificationDisposal" (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9-]{36}$'), "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseId" text NOT NULL, "evidenceId" text NOT NULL, "policyVersion" integer NOT NULL, "previewHash" text NOT NULL CHECK("previewHash" ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000), state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELETING','COMPLETED','CANCELLED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), "createdByUserId" text NOT NULL, "actorUserId" text NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" timestamp(3), "retryAfter" timestamp(3), "completedAt" timestamp(3),
 UNIQUE("tenantId",id),
 FOREIGN KEY("tenantId","caseId") REFERENCES "CustomerVerificationCase"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","caseId","evidenceId") REFERENCES "VerificationEvidence"("tenantId","caseId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","policyVersion") REFERENCES "VerificationRetentionVersion"("tenantId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","createdByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK((state IN ('PENDING','CANCELLED') AND "startedAt" IS NULL AND "retryAfter" IS NULL AND "completedAt" IS NULL) OR (state='DELETING' AND "startedAt" IS NOT NULL AND "retryAfter" IS NOT NULL AND "completedAt" IS NULL) OR (state='COMPLETED' AND "startedAt" IS NOT NULL AND "retryAfter" IS NULL AND "completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "VerificationDisposal_active_evidence" ON "VerificationDisposal"("tenantId","evidenceId") WHERE state<>'CANCELLED';
CREATE INDEX "VerificationDisposal_tenantId_caseId_state_idx" ON "VerificationDisposal"("tenantId","caseId",state);
CREATE TABLE "VerificationDisposalEvent" (
 "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE, "disposalId" text NOT NULL,
 version integer NOT NULL, state text NOT NULL, "actorUserId" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","disposalId",version),
 FOREIGN KEY("tenantId","disposalId") REFERENCES "VerificationDisposal"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION app.verification_disposal_authority(t text,a text) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT a IN ('read','create','approve','cancel') AND app.verification_permission_scope(t,'verificationDisposals.'||a)='ALL'
 AND app.verification_permission_scope(t,'verificationDisposals.read')='ALL' AND app.verification_permission_scope(t,'verificationEvidence.read')='ALL'
 AND app.verification_permission_scope(t,'customerVerification.read')='ALL' AND app.verification_permission_scope(t,'verificationRetention.read')='ALL'
 AND EXISTS(SELECT 1 FROM public."User" WHERE "tenantId"=t AND id=nullif(current_setting('app.actor_id',true),'') AND role='ADMIN' AND "collaboratorId" IS NULL)
$$;
CREATE FUNCTION app.verification_evidence_available(t text,e text) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND NOT EXISTS(SELECT 1 FROM public."VerificationDisposal" WHERE "tenantId"=t AND "evidenceId"=e AND state<>'CANCELLED')
$$;
CREATE FUNCTION app.verification_disposal_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE decision jsonb; e "VerificationEvidence"%ROWTYPE; operation text; uid text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Disposal history is retained' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 operation:=CASE WHEN TG_OP='INSERT' THEN 'create' WHEN NEW.state='CANCELLED' THEN 'cancel' ELSE 'approve' END;
 IF app.verification_disposal_authority(NEW."tenantId",operation) IS DISTINCT FROM true OR NEW."actorUserId" IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Administrative disposal authority is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM "VerificationEvidence" WHERE "tenantId"=NEW."tenantId" AND "caseId"=NEW."caseId" AND id=NEW."evidenceId" FOR UPDATE;
 IF e.id IS NULL OR e.state<>'READY' THEN RAISE EXCEPTION 'Choose an accepted original' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' OR (OLD.state='PENDING' AND NEW.state='DELETING') THEN
  decision:=app.verification_retention_decision(NEW."tenantId",e.id);
  IF decision->>'decision' IS DISTINCT FROM 'REVIEW' OR (decision->>'policyVersion')::integer IS DISTINCT FROM NEW."policyVersion" THEN RAISE EXCEPTION 'Disposal is blocked by retention, holds or saved references' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.state<>'PENDING' OR NEW."createdByUserId" IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Start with a pending disposal request' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=statement_timestamp(); NEW."startedAt":=NULL; NEW."retryAfter":=NULL; NEW."completedAt":=NULL;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."caseId",NEW."evidenceId",NEW."policyVersion",NEW."previewHash",NEW.reason,NEW."createdByUserId",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."caseId",OLD."evidenceId",OLD."policyVersion",OLD."previewHash",OLD.reason,OLD."createdByUserId",OLD."createdAt") OR NEW.version<>OLD.version+1 OR OLD.state IN ('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'Disposal identity and terminal history are immutable' USING ERRCODE='23514'; END IF;
  NEW."startedAt":=OLD."startedAt"; NEW."retryAfter":=OLD."retryAfter"; NEW."completedAt":=OLD."completedAt";
  IF NEW.state='DELETING' AND OLD.state IN ('PENDING','DELETING') THEN
   IF OLD.state='DELETING' AND OLD."retryAfter">clock_timestamp() THEN RAISE EXCEPTION 'Wait for the current removal attempt before reconciliation' USING ERRCODE='23514'; END IF;
   NEW."startedAt":=coalesce(OLD."startedAt",statement_timestamp()); NEW."retryAfter":=statement_timestamp()+interval '3 minutes';
  ELSIF OLD.state='DELETING' AND NEW.state='COMPLETED' THEN
   IF EXISTS(SELECT 1 FROM "VerificationSubmissionEvidence" WHERE "tenantId"=NEW."tenantId" AND "evidenceId"=e.id) OR (SELECT action FROM "VerificationHoldEvent" WHERE "tenantId"=NEW."tenantId" AND "caseId"=e."caseId" ORDER BY number DESC LIMIT 1)='PLACE' OR EXISTS(SELECT 1 FROM "OrderVerificationAcceptance" a WHERE a."tenantId"=NEW."tenantId" AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.proof->'participants') p WHERE p->>'caseId'=e."caseId")) THEN RAISE EXCEPTION 'Preservation references changed; reconcile before completion' USING ERRCODE='23514'; END IF;
   NEW."completedAt":=statement_timestamp(); NEW."retryAfter":=NULL;
  ELSIF NOT(OLD.state='PENDING' AND NEW.state='CANCELLED') THEN RAISE EXCEPTION 'An irreversible disposal cannot be cancelled or reopened' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verification_disposal_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationDisposal" FOR EACH ROW EXECUTE FUNCTION app.verification_disposal_write();
CREATE FUNCTION app.verification_disposal_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM "VerificationDisposal" d WHERE d."tenantId"=NEW."tenantId" AND d.id=NEW."disposalId" AND d.version=NEW.version AND d.state=NEW.state AND d."actorUserId"=NEW."actorUserId") THEN RAISE EXCEPTION 'Disposal events are immutable native history' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=statement_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER verification_disposal_event_guard BEFORE INSERT OR UPDATE OR DELETE ON "VerificationDisposalEvent" FOR EACH ROW EXECUTE FUNCTION app.verification_disposal_event_guard();
CREATE FUNCTION app.verification_disposal_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 INSERT INTO public."VerificationDisposalEvent"("tenantId","disposalId",version,state,"actorUserId") VALUES(NEW."tenantId",NEW.id,NEW.version,NEW.state,NEW."actorUserId");
 IF NEW.state='COMPLETED' THEN UPDATE public."VerificationEvidence" SET state='DISPOSED',filename='Disposed original',bytes=0,sha256=NULL,"cleanedAt"=NEW."completedAt" WHERE "tenantId"=NEW."tenantId" AND id=NEW."evidenceId"; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.verification_disposal_after() FROM PUBLIC;
CREATE TRIGGER verification_disposal_after AFTER INSERT OR UPDATE ON "VerificationDisposal" FOR EACH ROW EXECUTE FUNCTION app.verification_disposal_after();

ALTER TABLE "VerificationEvidence" DROP CONSTRAINT "VerificationEvidence_state_check", DROP CONSTRAINT "VerificationEvidence_bytes_check", DROP CONSTRAINT "VerificationEvidence_check1", DROP CONSTRAINT "VerificationEvidence_check3";
ALTER TABLE "VerificationEvidence" ADD CHECK(state IN ('PENDING','READY','ABANDONED','DISPOSED')),
 ADD CHECK((state='DISPOSED' AND bytes=0 AND filename='Disposed original' AND sha256 IS NULL AND "readyAt" IS NOT NULL AND "finalizedByUserId" IS NOT NULL AND "cleanedAt" IS NOT NULL) OR (state<>'DISPOSED' AND bytes BETWEEN 1 AND 5242880)),
 ADD CHECK((state='READY' AND sha256 IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND "readyAt" IS NOT NULL AND "finalizedByUserId" IS NOT NULL AND "cleanedAt" IS NULL AND "failureCode" IS NULL) OR (state IN ('PENDING','ABANDONED') AND sha256 IS NULL AND "readyAt" IS NULL AND "finalizedByUserId" IS NULL) OR state='DISPOSED'),
 ADD CHECK("cleanedAt" IS NULL OR state IN ('ABANDONED','DISPOSED'));

CREATE FUNCTION app.verification_disposal_reference_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF TG_TABLE_NAME='VerificationSubmissionEvidence' THEN
  IF EXISTS(SELECT 1 FROM public."VerificationDisposal" WHERE "tenantId"=NEW."tenantId" AND "evidenceId"=NEW."evidenceId" AND state<>'CANCELLED') THEN RAISE EXCEPTION 'Evidence is quarantined or disposed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='VerificationHoldEvent' THEN
  IF NEW.action='PLACE' AND EXISTS(SELECT 1 FROM public."VerificationDisposal" WHERE "tenantId"=NEW."tenantId" AND "caseId"=NEW."caseId" AND state='DELETING') THEN RAISE EXCEPTION 'An irreversible disposal is in progress; reconcile its outcome before placing a hold' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.proof->'participants') p JOIN public."VerificationDisposal" d ON d."tenantId"=NEW."tenantId" AND d."caseId"=p->>'caseId' AND d.state='DELETING') THEN RAISE EXCEPTION 'Customer verification checkpoint: disposal is in progress' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.verification_disposal_reference_guard() FROM PUBLIC;
CREATE TRIGGER zz_disposal_selection BEFORE INSERT ON "VerificationSubmissionEvidence" FOR EACH ROW EXECUTE FUNCTION app.verification_disposal_reference_guard();
CREATE TRIGGER zz_disposal_hold BEFORE INSERT ON "VerificationHoldEvent" FOR EACH ROW EXECUTE FUNCTION app.verification_disposal_reference_guard();
CREATE TRIGGER zz_disposal_acceptance BEFORE INSERT ON "OrderVerificationAcceptance" FOR EACH ROW EXECUTE FUNCTION app.verification_disposal_reference_guard();
ALTER TABLE "VerificationDisposal" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationDisposal" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VerificationDisposalEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationDisposalEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY disposal_read ON "VerificationDisposal" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR app.verification_disposal_authority("tenantId",'read')));
CREATE POLICY disposal_insert ON "VerificationDisposal" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_disposal_authority("tenantId",'create'));
CREATE POLICY disposal_update ON "VerificationDisposal" FOR UPDATE USING(app.tenant_match("tenantId") AND (app.verification_disposal_authority("tenantId",'approve') OR app.verification_disposal_authority("tenantId",'cancel'))) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY disposal_event_read ON "VerificationDisposalEvent" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR app.verification_disposal_authority("tenantId",'read')));
DROP POLICY evidence_read ON "VerificationEvidence";
CREATE POLICY evidence_read ON "VerificationEvidence" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR (EXISTS(SELECT 1 FROM "CustomerVerificationCase" c WHERE c."tenantId"="VerificationEvidence"."tenantId" AND c.id="caseId") AND (app.verification_disposal_authority("tenantId",'read') OR (app.verification_evidence_available("tenantId",id) AND ((state='READY' AND app.verification_permission_scope("tenantId",'verificationEvidence.read')='ALL') OR (app.verification_permission_scope("tenantId",'verificationUploads.read')='ALL' AND ("uploadedByUserId"=nullif(current_setting('app.actor_id',true),'') OR EXISTS(SELECT 1 FROM "User" WHERE "tenantId"="VerificationEvidence"."tenantId" AND id=nullif(current_setting('app.actor_id',true),'') AND role='ADMIN')))))))));
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON "VerificationDisposal" TO %I',who); EXECUTE format('GRANT SELECT ON "VerificationDisposalEvent" TO %I',who); END IF; END LOOP; END $$;

CREATE OR REPLACE FUNCTION app.verification_evidence_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text:=nullif(current_setting('app.actor_id',true),''); c "CustomerVerificationCase"%ROWTYPE; policy jsonb; admin_actor boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain verification evidence history' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 IF TG_OP='UPDATE' AND OLD.state='READY' AND NEW.state='DISPOSED' THEN
  IF pg_trigger_depth()<2 OR app.verification_disposal_authority(OLD."tenantId",'approve') IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM "VerificationDisposal" WHERE "tenantId"=OLD."tenantId" AND "evidenceId"=OLD.id AND state='COMPLETED') OR (to_jsonb(NEW)-ARRAY['state','filename','bytes','sha256','cleanedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','filename','bytes','sha256','cleanedAt']) OR NEW.filename<>'Disposed original' OR NEW.bytes<>0 OR NEW.sha256 IS NOT NULL OR NEW."cleanedAt" IS NULL THEN RAISE EXCEPTION 'Only completed native disposal may redact an unreferenced original' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;

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
COMMIT;
