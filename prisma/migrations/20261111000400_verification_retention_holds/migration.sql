BEGIN;
CREATE OR REPLACE FUNCTION app.verification_permission_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE COALESCE(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
 AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND u."collaboratorId" IS NULL
 AND p IN ('verificationPolicies.read','verificationPolicies.edit','customerVerification.read','customerVerification.create','contacts.read','accounts.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel','verificationEvidence.read','verificationSubmissions.read','verificationSubmissions.create','verificationReviews.read','verificationReviews.approve','verificationReviews.cancel','verificationRetention.read','verificationRetention.edit','verificationHolds.read','verificationHolds.create','verificationHolds.cancel')
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='crm' AND m.allowed AND m.enabled)
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='customerVerification' AND m.allowed AND m.enabled)
 AND (u.role='ADMIN' OR (
 EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions))
 AND COALESCE(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
  $$;
CREATE TABLE "VerificationRetentionVersion" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version integer NOT NULL CHECK(version>0), "retainDays" integer CHECK("retainDays" BETWEEN 1 AND 36500),
 "publishedByUserId" text NOT NULL, "publishedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId",version), FOREIGN KEY("tenantId","publishedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "VerificationHoldEvent" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseId" text NOT NULL, number integer NOT NULL CHECK(number>0), action text NOT NULL CHECK(action IN ('PLACE','RELEASE')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 1000), "actorUserId" text NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("tenantId","caseId",number),
 FOREIGN KEY("tenantId","caseId") REFERENCES "CustomerVerificationCase"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION app.verification_retention_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_version integer; prior_action text; capability text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Verification retention and holds are immutable' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 IF TG_TABLE_NAME='VerificationRetentionVersion' THEN
  IF app.verification_permission_scope(NEW."tenantId",'verificationRetention.edit') IS DISTINCT FROM 'ALL' OR NEW."publishedByUserId" IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') OR NOT EXISTS(SELECT 1 FROM "User" WHERE "tenantId"=NEW."tenantId" AND id=NEW."publishedByUserId" AND role='ADMIN') THEN RAISE EXCEPTION 'Retention publication is not permitted' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO prior_version FROM "VerificationRetentionVersion" WHERE "tenantId"=NEW."tenantId";
  IF NEW.version<>prior_version+1 THEN RAISE EXCEPTION 'Publish the next retention version' USING ERRCODE='23514'; END IF;
  NEW."publishedAt":=statement_timestamp();
 ELSE
  capability:='verificationHolds.'||CASE WHEN NEW.action='PLACE' THEN 'create' ELSE 'cancel' END;
  IF app.verification_permission_scope(NEW."tenantId",capability) IS DISTINCT FROM 'ALL' OR app.verification_permission_scope(NEW."tenantId",'verificationHolds.read') IS DISTINCT FROM 'ALL' OR NEW."actorUserId" IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') OR NOT EXISTS(SELECT 1 FROM "CustomerVerificationCase" WHERE "tenantId"=NEW."tenantId" AND id=NEW."caseId") THEN RAISE EXCEPTION 'Preservation hold is not permitted' USING ERRCODE='42501'; END IF;
  SELECT number,action INTO prior_version,prior_action FROM "VerificationHoldEvent" WHERE "tenantId"=NEW."tenantId" AND "caseId"=NEW."caseId" ORDER BY number DESC LIMIT 1;
  IF NEW.number<>coalesce(prior_version,0)+1 OR (NEW.action='PLACE' AND prior_action='PLACE') OR (NEW.action='RELEASE' AND prior_action IS DISTINCT FROM 'PLACE') THEN RAISE EXCEPTION 'The preservation hold changed' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=statement_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verification_retention_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationRetentionVersion" FOR EACH ROW EXECUTE FUNCTION app.verification_retention_write();
CREATE TRIGGER verification_hold_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationHoldEvent" FOR EACH ROW EXECUTE FUNCTION app.verification_retention_write();
ALTER TABLE "VerificationRetentionVersion" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationRetentionVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VerificationHoldEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationHoldEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY retention_read ON "VerificationRetentionVersion" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR app.verification_permission_scope("tenantId",'verificationRetention.read')='ALL'));
CREATE POLICY retention_insert ON "VerificationRetentionVersion" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationRetention.edit')='ALL');
CREATE POLICY verification_hold_read ON "VerificationHoldEvent" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR (app.verification_permission_scope("tenantId",'verificationHolds.read')='ALL' AND EXISTS(SELECT 1 FROM "CustomerVerificationCase" c WHERE c."tenantId"="VerificationHoldEvent"."tenantId" AND c.id="caseId"))));
CREATE POLICY verification_hold_insert ON "VerificationHoldEvent" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationHolds.read')='ALL' AND EXISTS(SELECT 1 FROM "CustomerVerificationCase" c WHERE c."tenantId"="VerificationHoldEvent"."tenantId" AND c.id="caseId"));

-- Administrative, read-only disposal review. No deletion capability or scheduler.
-- References are deliberately conservative: a revoked or superseded submission
-- remains a saved reference. Facts and accepted file identities are never erased.
CREATE FUNCTION app.verification_retention_decision(t text,eid text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE e public."VerificationEvidence"%ROWTYPE; cfg public."VerificationRetentionVersion"%ROWTYPE; last_action text; verdict text; until_at timestamp; now_at timestamptz:=clock_timestamp();
BEGIN
 IF app.verification_permission_scope(t,'verificationRetention.read') IS DISTINCT FROM 'ALL' OR app.verification_permission_scope(t,'verificationEvidence.read') IS DISTINCT FROM 'ALL' OR app.verification_permission_scope(t,'customerVerification.read') IS DISTINCT FROM 'ALL' OR NOT EXISTS(SELECT 1 FROM public."User" WHERE "tenantId"=t AND id=nullif(current_setting('app.actor_id',true),'') AND role='ADMIN') THEN RETURN NULL; END IF;
 SELECT * INTO e FROM public."VerificationEvidence" WHERE "tenantId"=t AND id=eid AND state='READY';
 IF e.id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO cfg FROM public."VerificationRetentionVersion" WHERE "tenantId"=t ORDER BY version DESC LIMIT 1;
 SELECT action INTO last_action FROM public."VerificationHoldEvent" WHERE "tenantId"=t AND "caseId"=e."caseId" ORDER BY number DESC LIMIT 1;
 until_at:=CASE WHEN cfg."retainDays" IS NOT NULL THEN e."readyAt"+cfg."retainDays"*interval '1 day' ELSE NULL END;
 verdict:=CASE WHEN last_action='PLACE' THEN 'HOLD'
 WHEN EXISTS(SELECT 1 FROM public."OrderVerificationAcceptance" a WHERE a."tenantId"=t AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.proof->'participants') p WHERE p->>'caseId'=e."caseId")) THEN 'TRANSACTION_REFERENCE'
 WHEN EXISTS(SELECT 1 FROM public."VerificationSubmissionEvidence" s WHERE s."tenantId"=t AND s."evidenceId"=eid) THEN 'SUBMISSION_REFERENCE'
 WHEN cfg."retainDays" IS NULL THEN 'INDEFINITE'
 WHEN until_at>now_at AT TIME ZONE 'UTC' THEN 'PERIOD' ELSE 'REVIEW' END;
 RETURN jsonb_build_object('decision',verdict,'retainUntil',until_at AT TIME ZONE 'UTC','evaluatedAt',now_at,'policyVersion',coalesce(cfg.version,0));
END $$;
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT ON "VerificationRetentionVersion","VerificationHoldEvent" TO %I',who); END IF; END LOOP; END $$;
COMMIT;
