BEGIN;
CREATE TABLE "VerificationCheckpointVersion" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version integer NOT NULL CHECK(version>0), definition jsonb NOT NULL, "publishedByUserId" text NOT NULL,
 "publishedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("tenantId",version),
 FOREIGN KEY("tenantId","publishedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "OrderVerificationAcceptance" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "orderId" text NOT NULL, checkpoint text NOT NULL CHECK(checkpoint IN ('ORDER_CONFIRMATION','UNIT_ALLOCATION','ORDER_DOCUMENT')),
 "sourceId" text NOT NULL, "sourceVersion" integer NOT NULL CHECK("sourceVersion">0), "configurationVersion" integer NOT NULL,
 "actorUserId" text NOT NULL, "evaluatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, proof jsonb NOT NULL,
 FOREIGN KEY("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","configurationVersion") REFERENCES "VerificationCheckpointVersion"("tenantId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE("tenantId",checkpoint,"sourceId","sourceVersion")
);
CREATE INDEX "OrderVerificationAcceptance_tenantId_orderId_evaluatedAt_idx" ON "OrderVerificationAcceptance"("tenantId","orderId","evaluatedAt");

-- Closed permission projection; operational source reads do not require private KYC.
CREATE FUNCTION app.verification_operational_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE coalesce(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
 AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u."collaboratorId" IS NULL OR p IN ('salesOrders.read','opportunities.read'))
 AND p IN ('verificationCheckpoints.read','verificationCheckpoints.edit','verificationSummaries.read','salesOrders.read','opportunities.read')
 AND (u.role='ADMIN' OR (EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions)) AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions)) AND coalesce(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
$$;
CREATE FUNCTION app.verification_source_allowed(t text,k text,i text) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o public."CrmOpportunity"%ROWTYPE; s text; r text; uid text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF k NOT IN ('ORDER','OPPORTUNITY') THEN RETURN false; END IF;
 r:=CASE WHEN k='ORDER' THEN 'salesOrders' ELSE 'opportunities' END; s:=app.verification_operational_scope(t,r||'.read');
 IF s IS NULL OR s NOT IN ('OWN','MANAGED_TEAMS','ALL') OR NOT EXISTS(SELECT 1 FROM public."TenantModule" WHERE "tenantId"=t AND key='crm' AND allowed AND enabled) THEN RETURN false; END IF;
 IF k='ORDER' THEN
  IF NOT EXISTS(SELECT 1 FROM public."TenantModule" WHERE "tenantId"=t AND key='salesOrders' AND allowed AND enabled) THEN RETURN false; END IF;
  SELECT opp.* INTO o FROM public."SalesOrder" so JOIN public."CrmQuotation" q ON q."tenantId"=so."tenantId" AND q.id=so."quotationId" JOIN public."CrmOpportunity" opp ON opp."tenantId"=q."tenantId" AND opp.id=q."opportunityId" WHERE so."tenantId"=t AND so.id=i;
 ELSE SELECT * INTO o FROM public."CrmOpportunity" WHERE "tenantId"=t AND id=i; END IF;
 RETURN o.id IS NOT NULL AND app.business_office_access(t,o."officeId",uid) AND app.record_sharing_allowed(t,r,i,uid,'READ') AND (s='ALL' OR o."assignedUserId"=uid OR app.verification_shared(t,r,i) OR (s='MANAGED_TEAMS' AND EXISTS(SELECT 1 FROM public."BusinessTeamMember" m JOIN public."BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId" AND NOT team.archived WHERE m."tenantId"=t AND m."teamId"=o."salesTeamId" AND m."userId"=uid AND m."isManager")));
END $$;
-- This Boolean guard is safe to call directly and is also used by invoker RLS.

CREATE FUNCTION app.verification_checkpoint_valid(d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN jsonb_typeof(d)='object' AND (SELECT count(*) FROM jsonb_object_keys(d))=3 AND d->'format'='1'::jsonb AND d ?& ARRAY['format','roles','checkpoints']
 AND jsonb_typeof(d->'roles')='array' AND jsonb_array_length(d->'roles') BETWEEN 1 AND 3 AND d->'roles' ? 'CUSTOMER'
 AND (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(d->'roles') v)=jsonb_array_length(d->'roles') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'roles') v WHERE v NOT IN ('CUSTOMER','ADDITIONAL_CUSTOMER','REPRESENTATIVE'))
 AND jsonb_typeof(d->'checkpoints')='object' AND (SELECT count(*) FROM jsonb_object_keys(d->'checkpoints'))=3 AND d->'checkpoints' ?& ARRAY['ORDER_CONFIRMATION','UNIT_ALLOCATION','ORDER_DOCUMENT']
 AND NOT EXISTS(SELECT 1 FROM jsonb_each(d->'checkpoints') v WHERE v.value NOT IN ('"OFF"'::jsonb,'"WARN"'::jsonb,'"REQUIRED"'::jsonb));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE "VerificationCheckpointVersion" ADD CHECK(coalesce(app.verification_checkpoint_valid(definition),false));
CREATE FUNCTION app.verification_checkpoint_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seq integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Verification checkpoint settings are immutable' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 IF app.verification_operational_scope(NEW."tenantId",'verificationCheckpoints.edit') IS DISTINCT FROM 'ALL' OR NEW."publishedByUserId" IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') OR NOT EXISTS(SELECT 1 FROM "User" WHERE "tenantId"=NEW."tenantId" AND id=NEW."publishedByUserId" AND role='ADMIN') OR app.verification_permission_scope(NEW."tenantId",'customerVerification.read') IS DISTINCT FROM 'ALL' THEN RAISE EXCEPTION 'Verification checkpoint publication is not permitted' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(version),0) INTO seq FROM "VerificationCheckpointVersion" WHERE "tenantId"=NEW."tenantId";
 IF NEW.version<>seq+1 OR (EXISTS(SELECT 1 FROM jsonb_each_text(NEW.definition->'checkpoints') v WHERE v.value<>'OFF') AND app.verification_latest_version(NEW."tenantId") IS NULL) THEN RAISE EXCEPTION 'Publish current checkpoint settings after verification requirements' USING ERRCODE='23514'; END IF;
 NEW."publishedAt":=statement_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER verification_checkpoint_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationCheckpointVersion" FOR EACH ROW EXECUTE FUNCTION app.verification_checkpoint_write();

-- Each participant role has its own latest review; case revision tokens remain global.
CREATE OR REPLACE FUNCTION app.verification_review_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text:=nullif(current_setting('app.actor_id',true),''); s "VerificationSubmission"%ROWTYPE; prior "VerificationReview"%ROWTYPE; p jsonb; seq integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Verification decisions are immutable' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 IF NEW."reviewedByUserId" IS DISTINCT FROM uid OR app.verification_permission_scope(NEW."tenantId",'verificationReviews.'||CASE WHEN NEW.decision='REVOKED' THEN 'cancel' ELSE 'approve' END) IS DISTINCT FROM 'ALL' OR app.verification_permission_scope(NEW."tenantId",'verificationEvidence.read') IS DISTINCT FROM 'ALL' THEN RAISE EXCEPTION 'Independent verification review is not permitted' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM "VerificationSubmission" WHERE "tenantId"=NEW."tenantId" AND id=NEW."submissionId";
 IF s.id IS NULL THEN RAISE EXCEPTION 'Verification submission is not accessible' USING ERRCODE='42501'; END IF;
 IF NEW.decision<>'REVOKED' AND EXISTS(SELECT 1 FROM "CustomerVerificationCase" c LEFT JOIN "CrmContact" person ON person."tenantId"=c."tenantId" AND person.id=c."contactId" LEFT JOIN "CrmAccount" business ON business."tenantId"=c."tenantId" AND business.id=c."accountId" WHERE c."tenantId"=s."tenantId" AND c.id=s."caseId" AND (person.archived OR business.archived)) THEN RAISE EXCEPTION 'Review an active customer' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM "VerificationReview" WHERE "tenantId"=NEW."tenantId" AND "submissionId"=s.id ORDER BY number DESC LIMIT 1;
 IF NEW.number<>coalesce(prior.number,0)+1 OR (NEW.decision='REVOKED' AND prior.decision IS DISTINCT FROM 'APPROVED') OR (NEW.decision<>'REVOKED' AND prior.id IS NOT NULL) THEN RAISE EXCEPTION 'The review changed; submit corrections as a new revision' USING ERRCODE='23514'; END IF;
 SELECT max(number) INTO seq FROM "VerificationSubmission" WHERE "tenantId"=s."tenantId" AND "caseId"=s."caseId" AND role=s.role;
 IF NEW.decision<>'REVOKED' AND seq<>s.number THEN RAISE EXCEPTION 'Review the latest submission' USING ERRCODE='23514'; END IF;
 IF NEW.decision='APPROVED' AND (s."submittedByUserId"=uid OR EXISTS(SELECT 1 FROM "VerificationSubmissionEvidence" l JOIN "VerificationEvidence" e ON e."tenantId"=l."tenantId" AND e.id=l."evidenceId" WHERE l."tenantId"=s."tenantId" AND l."submissionId"=s.id AND uid IN (e."uploadedByUserId",e."finalizedByUserId"))) THEN RAISE EXCEPTION 'A different reviewer must approve this submission and evidence' USING ERRCODE='42501'; END IF;
 p:=app.verification_submission_policy(NEW."tenantId",s."policyVersion");
 IF NEW.decision='APPROVED' AND s."policyVersion" IS DISTINCT FROM app.verification_latest_version(NEW."tenantId") THEN RAISE EXCEPTION 'Submit the current policy before approval' USING ERRCODE='23514'; END IF;
 NEW."reviewedAt":=statement_timestamp(); NEW."validUntil":=CASE WHEN NEW.decision='APPROVED' AND p->'definition'->>'validityDays' IS NOT NULL THEN NEW."reviewedAt"+((p->'definition'->>'validityDays')::integer*interval '1 day') ELSE NULL END;
 RETURN NEW;
END $$;

-- Private engine: derives identifiers and verdicts only; never identity values/files.
CREATE FUNCTION app.verification_evaluate(t text,participants jsonb,roles jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE p jsonb; c public."CustomerVerificationCase"%ROWTYPE; s public."VerificationSubmission"%ROWTYPE; r public."VerificationReview"%ROWTYPE; result jsonb:='[]'; verdict text; current_policy integer; now_at timestamptz:=clock_timestamp(); active boolean;
BEGIN
 SELECT max(version) INTO current_policy FROM public."VerificationPolicyVersion" WHERE "tenantId"=t;
 SELECT EXISTS(SELECT 1 FROM public."TenantModule" WHERE "tenantId"=t AND key='customerVerification' AND allowed AND enabled) INTO active;
 IF jsonb_typeof(participants) IS DISTINCT FROM 'array' OR jsonb_array_length(participants) NOT BETWEEN 1 AND 100 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(participants) v WHERE v->>'role'='CUSTOMER') THEN RETURN jsonb_build_array(jsonb_build_object('role','CUSTOMER','status','UNRESOLVED')); END IF;
 FOR p IN SELECT * FROM jsonb_array_elements(participants) v WHERE roles ? (v->>'role') LOOP
  c:=NULL; s:=NULL; r:=NULL; verdict:='NOT_STARTED';
  IF NOT active THEN verdict:='MODULE_DISABLED';
  ELSIF coalesce(p->'party'->>'kind','') NOT IN ('PERSON','BUSINESS') OR coalesce(p->'party'->>'id','')='' THEN verdict:='UNRESOLVED';
  ELSIF (p->'party'->>'kind'='PERSON' AND NOT EXISTS(SELECT 1 FROM public."CrmContact" WHERE "tenantId"=t AND id=p->'party'->>'id' AND NOT archived)) OR (p->'party'->>'kind'='BUSINESS' AND NOT EXISTS(SELECT 1 FROM public."CrmAccount" WHERE "tenantId"=t AND id=p->'party'->>'id' AND NOT archived)) THEN verdict:='UNAVAILABLE';
  ELSE
   SELECT * INTO c FROM public."CustomerVerificationCase" WHERE "tenantId"=t AND CASE WHEN p->'party'->>'kind'='PERSON' THEN "contactId"=p->'party'->>'id' ELSE "accountId"=p->'party'->>'id' END;
   IF c.id IS NOT NULL THEN
    SELECT * INTO s FROM public."VerificationSubmission" WHERE "tenantId"=t AND "caseId"=c.id AND role=p->>'role' ORDER BY number DESC LIMIT 1;
    verdict:=CASE WHEN s.id IS NULL THEN 'IN_PROGRESS' ELSE 'UNDER_REVIEW' END;
    IF s.id IS NOT NULL THEN
     SELECT * INTO r FROM public."VerificationReview" WHERE "tenantId"=t AND "submissionId"=s.id ORDER BY number DESC LIMIT 1;
     verdict:=CASE WHEN r.id IS NULL THEN 'UNDER_REVIEW' WHEN r.decision='REVOKED' THEN 'REVOKED' WHEN r.decision='CHANGES_REQUIRED' THEN 'CHANGES_REQUIRED' WHEN r."validUntil" IS NOT NULL AND r."validUntil"<=now_at THEN 'EXPIRED' WHEN s."policyVersion" IS DISTINCT FROM current_policy THEN 'REVIEW_REQUIRED' ELSE 'VERIFIED' END;
    END IF;
   END IF;
  END IF;
  result:=result||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind',p->'party'->>'kind','id',p->'party'->>'id','role',p->>'role','status',verdict,'caseId',c.id,'submissionId',s.id,'submissionNumber',s.number,'policyVersion',s."policyVersion",'reviewId',r.id,'reviewedByUserId',r."reviewedByUserId",'reviewedAt',r."reviewedAt" AT TIME ZONE 'UTC','validUntil',r."validUntil" AT TIME ZONE 'UTC')));
 END LOOP;
 IF jsonb_array_length(result)=0 THEN RETURN jsonb_build_array(jsonb_build_object('role','CUSTOMER','status','UNRESOLVED')); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.verification_evaluate(text,jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION app.verification_source_participants(t text,k text,i text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o public."CrmOpportunity"%ROWTYPE; result jsonb;
BEGIN
 IF k='ORDER' THEN SELECT snapshot->'participants'->'participants' INTO result FROM public."SalesOrder" WHERE "tenantId"=t AND id=i; RETURN result; END IF;
 SELECT * INTO o FROM public."CrmOpportunity" WHERE "tenantId"=t AND id=i;
 SELECT jsonb_build_array(jsonb_build_object('role',CASE WHEN o."accountId" IS NULL THEN 'CUSTOMER' ELSE 'REPRESENTATIVE' END,'party',jsonb_build_object('kind','PERSON','id',c.id,'name',c.name))) INTO result FROM public."CrmContact" c WHERE c."tenantId"=t AND c.id=o."contactId";
 IF o."accountId" IS NOT NULL THEN SELECT jsonb_build_array(jsonb_build_object('role','CUSTOMER','party',jsonb_build_object('kind','BUSINESS','id',a.id,'name',a.name)))||result INTO result FROM public."CrmAccount" a WHERE a."tenantId"=t AND a.id=o."accountId"; END IF;
 SELECT result||coalesce(jsonb_agg(jsonb_build_object('role',v.role,'party',jsonb_build_object('kind',CASE WHEN v."contactId" IS NOT NULL THEN 'PERSON' ELSE 'BUSINESS' END,'id',coalesce(v."contactId",v."accountId"),'name',v.details->>'name')) ORDER BY v.position,v.id),'[]') INTO result FROM public."CrmOpportunityParticipant" v WHERE v."tenantId"=t AND v."opportunityId"=i;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.verification_source_participants(text,text,text) FROM PUBLIC;
CREATE FUNCTION app.verification_source_summary(t text,k text,i text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE participants jsonb; statuses jsonb; result jsonb;
BEGIN
 IF app.verification_operational_scope(t,'verificationSummaries.read') IS DISTINCT FROM 'ALL' OR app.verification_source_allowed(t,k,i) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public."TenantModule" WHERE "tenantId"=t AND key='customerVerification' AND allowed AND enabled) THEN RETURN NULL; END IF;
 participants:=app.verification_source_participants(t,k,i); statuses:=app.verification_evaluate(t,participants,'["CUSTOMER","ADDITIONAL_CUSTOMER","REPRESENTATIVE"]');
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',v->>'kind','id',v->>'id','role',v->>'role','status',v->>'status','name',(SELECT p->'party'->>'name' FROM jsonb_array_elements(participants) p WHERE p->'party'->>'kind'=v->>'kind' AND p->'party'->>'id'=v->>'id' AND p->>'role'=v->>'role' LIMIT 1),'validUntil',v->>'validUntil')),'[]') INTO result FROM jsonb_array_elements(statuses) v;
 RETURN jsonb_build_object('participants',result);
END $$;

CREATE FUNCTION app.verification_checkpoint_proof(t text,o text,k text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE cfg public."VerificationCheckpointVersion"%ROWTYPE; result jsonb; participants jsonb; mode text; policy integer;
BEGIN
 SELECT * INTO cfg FROM public."VerificationCheckpointVersion" WHERE "tenantId"=t ORDER BY version DESC LIMIT 1;
 mode:=coalesce(cfg.definition->'checkpoints'->>k,'OFF');
 IF mode='OFF' THEN RETURN jsonb_build_object('format',1,'mode','OFF','configurationVersion',coalesce(cfg.version,0),'eligible',true,'participants','[]'::jsonb); END IF;
 SELECT max(version) INTO policy FROM public."VerificationPolicyVersion" WHERE "tenantId"=t;
 participants:=app.verification_source_participants(t,'ORDER',o);
 result:=app.verification_evaluate(t,participants,cfg.definition->'roles');
 RETURN jsonb_build_object('format',1,'mode',mode,'configurationVersion',cfg.version,'policyVersion',policy,'eligible',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) v WHERE v->>'status'<>'VERIFIED'),'participants',result);
END $$;
REVOKE ALL ON FUNCTION app.verification_checkpoint_proof(text,text,text) FROM PUBLIC;
CREATE FUNCTION app.verification_checkpoint_review(t text,o text,k text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE proof jsonb;
BEGIN
 IF k NOT IN ('ORDER_CONFIRMATION','UNIT_ALLOCATION','ORDER_DOCUMENT') OR app.verification_source_allowed(t,'ORDER',o) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 proof:=app.verification_checkpoint_proof(t,o,k);
 RETURN jsonb_build_object('mode',proof->>'mode','configurationVersion',proof->'configurationVersion','eligible',proof->'eligible','missingCount',(SELECT count(*) FROM jsonb_array_elements(proof->'participants') v WHERE v->>'status'<>'VERIFIED'),'token',encode(sha256(convert_to(proof::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION app.verification_acceptance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE order_id text; checkpoint_key text; proof jsonb; uid text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF TG_TABLE_NAME='SalesOrder' THEN IF NOT(OLD.status='DRAFT' AND NEW.status='CONFIRMED') THEN RETURN NEW; END IF; order_id:=NEW.id; checkpoint_key:='ORDER_CONFIRMATION';
 ELSIF TG_TABLE_NAME='UnitReservation' THEN IF NOT(OLD.status='HELD' AND NEW.status='ALLOCATED') THEN RETURN NEW; END IF; order_id:=NEW."orderId"; checkpoint_key:='UNIT_ALLOCATION';
 ELSE order_id:=NEW."orderId"; checkpoint_key:='ORDER_DOCUMENT'; END IF;
 PERFORM id FROM public."Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 proof:=app.verification_checkpoint_proof(NEW."tenantId",order_id,checkpoint_key);
 IF proof->>'mode'='OFF' THEN RETURN NEW; END IF;
 IF app.verification_source_allowed(NEW."tenantId",'ORDER',order_id) IS DISTINCT FROM true OR (proof->>'mode'='REQUIRED' AND proof->'eligible'<>'true'::jsonb) THEN RAISE EXCEPTION 'Customer verification checkpoint: approval is required for every applicable participant' USING ERRCODE='23514'; END IF;
 INSERT INTO public."OrderVerificationAcceptance"("tenantId","orderId",checkpoint,"sourceId","sourceVersion","configurationVersion","actorUserId",proof) VALUES(NEW."tenantId",order_id,checkpoint_key,NEW.id,NEW.version,(proof->>'configurationVersion')::integer,uid,proof);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.verification_acceptance_guard() FROM PUBLIC;
CREATE TRIGGER zz_verification_confirmation AFTER UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.verification_acceptance_guard();
CREATE TRIGGER zz_verification_allocation AFTER UPDATE ON "UnitReservation" FOR EACH ROW EXECUTE FUNCTION app.verification_acceptance_guard();
CREATE TRIGGER zz_verification_document AFTER INSERT ON "SalesOrderDocument" FOR EACH ROW EXECUTE FUNCTION app.verification_acceptance_guard();
CREATE FUNCTION app.verification_acceptance_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF pg_trigger_depth()<2 OR NEW."tenantId" IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR NEW."actorUserId" IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') OR NEW.proof IS DISTINCT FROM app.verification_checkpoint_proof(NEW."tenantId",NEW."orderId",NEW.checkpoint) OR NEW.proof->>'mode'='OFF' THEN RAISE EXCEPTION 'Customer verification checkpoint: acceptance must be minted by its native transaction action' USING ERRCODE='23514'; END IF;
 NEW."evaluatedAt":=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.verification_acceptance_write() FROM PUBLIC;
CREATE TRIGGER verification_acceptance_write BEFORE INSERT ON "OrderVerificationAcceptance" FOR EACH ROW EXECUTE FUNCTION app.verification_acceptance_write();
CREATE TRIGGER verification_acceptance_immutable BEFORE UPDATE OR DELETE ON "OrderVerificationAcceptance" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event();
ALTER TABLE "VerificationCheckpointVersion" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationCheckpointVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OrderVerificationAcceptance" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OrderVerificationAcceptance" FORCE ROW LEVEL SECURITY;
CREATE POLICY checkpoint_read ON "VerificationCheckpointVersion" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR app.verification_operational_scope("tenantId",'verificationCheckpoints.read')='ALL'));
CREATE POLICY checkpoint_insert ON "VerificationCheckpointVersion" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_operational_scope("tenantId",'verificationCheckpoints.edit')='ALL');
CREATE POLICY acceptance_read ON "OrderVerificationAcceptance" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR (app.verification_operational_scope("tenantId",'verificationSummaries.read')='ALL' AND app.verification_source_allowed("tenantId",'ORDER',"orderId"))));
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT ON "VerificationCheckpointVersion" TO %I',who); EXECUTE format('GRANT SELECT ON "OrderVerificationAcceptance" TO %I',who); END IF; END LOOP; END $$;
COMMIT;
