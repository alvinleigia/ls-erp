BEGIN;
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_tenantId_caseId_id_key" UNIQUE("tenantId","caseId",id);
CREATE TABLE "VerificationSubmission" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "caseId" text NOT NULL, number integer NOT NULL CHECK(number>0), "policyVersion" integer NOT NULL,
 role text NOT NULL CHECK(role IN ('CUSTOMER','ADDITIONAL_CUSTOMER','REPRESENTATIVE')), facts jsonb NOT NULL,
 reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
 "submittedByUserId" text NOT NULL, "submittedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId",id), UNIQUE("tenantId","caseId",id), UNIQUE("tenantId","caseId",number),
 FOREIGN KEY("tenantId","caseId") REFERENCES "CustomerVerificationCase"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","policyVersion") REFERENCES "VerificationPolicyVersion"("tenantId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","submittedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(number=1 OR reason IS NOT NULL)
);
CREATE TABLE "VerificationSubmissionEvidence" (
 "tenantId" text NOT NULL, "caseId" text NOT NULL, "submissionId" text NOT NULL, "evidenceId" text NOT NULL,
 PRIMARY KEY("tenantId","submissionId","evidenceId"),
 FOREIGN KEY("tenantId","caseId","submissionId") REFERENCES "VerificationSubmission"("tenantId","caseId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","caseId","evidenceId") REFERENCES "VerificationEvidence"("tenantId","caseId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "VerificationReview" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "submissionId" text NOT NULL, number integer NOT NULL CHECK(number>0),
 decision text NOT NULL CHECK(decision IN ('APPROVED','CHANGES_REQUIRED','REVOKED')),
 reason text CHECK(reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
 "reviewedByUserId" text NOT NULL, "reviewedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "validUntil" timestamp(3),
 UNIQUE("tenantId",id), UNIQUE("tenantId","submissionId",number),
 FOREIGN KEY("tenantId","submissionId") REFERENCES "VerificationSubmission"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","reviewedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK(decision='APPROVED' OR (reason IS NOT NULL AND "validUntil" IS NULL))
);

CREATE OR REPLACE FUNCTION app.verification_permission_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE COALESCE(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
 AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND u."collaboratorId" IS NULL
 AND p IN ('verificationPolicies.read','verificationPolicies.edit','customerVerification.read','customerVerification.create','contacts.read','accounts.read','verificationUploads.read','verificationUploads.create','verificationUploads.cancel','verificationEvidence.read','verificationSubmissions.read','verificationSubmissions.create','verificationReviews.read','verificationReviews.approve','verificationReviews.cancel')
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='crm' AND m.allowed AND m.enabled)
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='customerVerification' AND m.allowed AND m.enabled)
 AND (u.role='ADMIN' OR (
 EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions))
 AND COALESCE(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
$$;

-- Definition projection contains requirements only, never customer values.
CREATE FUNCTION app.verification_submission_policy(t text,v integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('version',version,'definition',definition) FROM public."VerificationPolicyVersion"
 WHERE "tenantId"=t AND app.verification_permission_scope(t,'customerVerification.read')='ALL'
 AND app.verification_permission_scope(t,'verificationSubmissions.read')='ALL' AND (v IS NULL OR version=v) ORDER BY version DESC LIMIT 1
$$;

CREATE FUNCTION app.verification_facts_valid(d jsonb,k text,r text,values_json jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f jsonb; v text; required jsonb;
BEGIN
 IF jsonb_typeof(values_json) IS DISTINCT FROM 'array' OR jsonb_array_length(values_json)>30 THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO required FROM jsonb_array_elements(d->'facts') x WHERE x->'subjects' ? k AND x->'roles' ? r;
 IF jsonb_array_length(required)<>jsonb_array_length(values_json) OR (SELECT count(DISTINCT x->>'code') FROM jsonb_array_elements(values_json) x)<>jsonb_array_length(values_json) THEN RETURN false; END IF;
 FOR f IN SELECT * FROM jsonb_array_elements(values_json) LOOP
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(f))<>2 OR NOT(f ?& ARRAY['code','value']) OR jsonb_typeof(f->'value') IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(required) x WHERE x->>'code'=f->>'code') THEN RETURN false; END IF;
  v:=f->>'value'; IF length(v) NOT BETWEEN 1 AND 500 OR v<>btrim(v) THEN RETURN false; END IF;
  SELECT x INTO f FROM jsonb_array_elements(required) x WHERE x->>'code'=f->>'code';
  IF f->>'type'='DATE' AND (v !~ '^\d{4}-\d{2}-\d{2}$' OR NOT pg_input_is_valid(v,'date') OR v LIKE '0000-%') THEN RETURN false; END IF;
  IF f->>'type'='EMAIL' AND (length(v)>254 OR v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RETURN false; END IF;
  IF f->>'type'='COUNTRY' AND NOT(v=ANY(ARRAY['Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica','Croatia','Cuba','Cyprus','Czechia','Democratic Republic of the Congo','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway','Oman','Pakistan','Palau','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe']::text[])) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION app.verification_submission_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid text:=nullif(current_setting('app.actor_id',true),''); c "CustomerVerificationCase"%ROWTYPE; s "VerificationSubmission"%ROWTYPE; p jsonb; k text; seq integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Verification submissions and evidence selections are immutable' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 IF app.verification_permission_scope(NEW."tenantId",'verificationSubmissions.create') IS DISTINCT FROM 'ALL' THEN RAISE EXCEPTION 'Verification submission is not permitted' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM "CustomerVerificationCase" WHERE "tenantId"=NEW."tenantId" AND id=NEW."caseId";
 IF c.id IS NULL THEN RAISE EXCEPTION 'Verification case is not accessible' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='VerificationSubmissionEvidence' THEN
  SELECT * INTO s FROM "VerificationSubmission" WHERE "tenantId"=NEW."tenantId" AND id=NEW."submissionId" AND xmin::text=pg_current_xact_id()::text;
  IF s.id IS NULL OR s."submittedByUserId"<>uid OR NOT EXISTS(SELECT 1 FROM "VerificationEvidence" e WHERE e."tenantId"=NEW."tenantId" AND e."caseId"=NEW."caseId" AND e.id=NEW."evidenceId" AND e.state='READY' AND (e."uploadedByUserId"=uid OR app.verification_permission_scope(NEW."tenantId",'verificationEvidence.read')='ALL')) THEN RAISE EXCEPTION 'Select accepted accessible evidence while submitting this revision' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."submittedByUserId" IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Submission identity is not permitted' USING ERRCODE='42501'; END IF;
 SELECT coalesce(max(number),0) INTO seq FROM "VerificationSubmission" WHERE "tenantId"=NEW."tenantId" AND "caseId"=NEW."caseId";
 IF NEW.number<>seq+1 THEN RAISE EXCEPTION 'Submit the next verification revision' USING ERRCODE='23514'; END IF;
 p:=app.verification_submission_policy(NEW."tenantId"); k:=CASE WHEN c."contactId" IS NOT NULL THEN 'PERSON' ELSE 'BUSINESS' END;
 IF p IS NULL OR NEW."policyVersion"<>(p->>'version')::integer OR NOT app.verification_facts_valid(p->'definition',k,NEW.role,NEW.facts) OR EXISTS(SELECT 1 FROM "CrmContact" WHERE id=c."contactId" AND "tenantId"=c."tenantId" AND archived) OR EXISTS(SELECT 1 FROM "CrmAccount" WHERE id=c."accountId" AND "tenantId"=c."tenantId" AND archived) THEN RAISE EXCEPTION 'Complete current verification requirements for an active customer' USING ERRCODE='23514'; END IF;
 NEW."submittedAt":=statement_timestamp(); RETURN NEW;
END $$;

-- Deferred validation prevents accepting a header with omitted/mismatched files.
CREATE FUNCTION app.verification_submission_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p jsonb; k text; total integer;
BEGIN
 SELECT CASE WHEN "contactId" IS NOT NULL THEN 'PERSON' ELSE 'BUSINESS' END INTO k FROM "CustomerVerificationCase" WHERE "tenantId"=NEW."tenantId" AND id=NEW."caseId";
 p:=app.verification_submission_policy(NEW."tenantId",NEW."policyVersion")->'definition';
 SELECT count(*) INTO total FROM "VerificationSubmissionEvidence" WHERE "tenantId"=NEW."tenantId" AND "submissionId"=NEW.id;
 IF total>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'documents') d WHERE d->'subjects' ? k AND d->'roles' ? NEW.role AND NOT EXISTS(SELECT 1 FROM "VerificationSubmissionEvidence" l JOIN "VerificationEvidence" e ON e."tenantId"=l."tenantId" AND e.id=l."evidenceId" WHERE l."tenantId"=NEW."tenantId" AND l."submissionId"=NEW.id AND e.state='READY' AND e."documentCode"=d->>'code')) OR EXISTS(SELECT 1 FROM "VerificationSubmissionEvidence" l JOIN "VerificationEvidence" e ON e."tenantId"=l."tenantId" AND e.id=l."evidenceId" WHERE l."tenantId"=NEW."tenantId" AND l."submissionId"=NEW.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'documents') d WHERE d->'subjects' ? k AND d->'roles' ? NEW.role AND d->>'code'=e."documentCode")) THEN RAISE EXCEPTION 'Complete the required evidence selection for this revision' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION app.verification_review_write() RETURNS trigger LANGUAGE plpgsql AS $$
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
 SELECT max(number) INTO seq FROM "VerificationSubmission" WHERE "tenantId"=s."tenantId" AND "caseId"=s."caseId";
 IF NEW.decision<>'REVOKED' AND seq<>s.number THEN RAISE EXCEPTION 'Review the latest submission' USING ERRCODE='23514'; END IF;
 IF NEW.decision='APPROVED' AND (s."submittedByUserId"=uid OR EXISTS(SELECT 1 FROM "VerificationSubmissionEvidence" l JOIN "VerificationEvidence" e ON e."tenantId"=l."tenantId" AND e.id=l."evidenceId" WHERE l."tenantId"=s."tenantId" AND l."submissionId"=s.id AND uid IN (e."uploadedByUserId",e."finalizedByUserId"))) THEN RAISE EXCEPTION 'A different reviewer must approve this submission and evidence' USING ERRCODE='42501'; END IF;
 p:=app.verification_submission_policy(NEW."tenantId",s."policyVersion");
 IF NEW.decision='APPROVED' AND s."policyVersion" IS DISTINCT FROM app.verification_latest_version(NEW."tenantId") THEN RAISE EXCEPTION 'Submit the current policy before approval' USING ERRCODE='23514'; END IF;
 NEW."reviewedAt":=statement_timestamp(); NEW."validUntil":=CASE WHEN NEW.decision='APPROVED' AND p->'definition'->>'validityDays' IS NOT NULL THEN NEW."reviewedAt"+((p->'definition'->>'validityDays')::integer*interval '1 day') ELSE NULL END;
 RETURN NEW;
END $$;

CREATE TRIGGER verification_submission_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationSubmission" FOR EACH ROW EXECUTE FUNCTION app.verification_submission_write();
CREATE TRIGGER verification_selection_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationSubmissionEvidence" FOR EACH ROW EXECUTE FUNCTION app.verification_submission_write();
CREATE CONSTRAINT TRIGGER verification_submission_complete AFTER INSERT ON "VerificationSubmission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.verification_submission_complete();
CREATE TRIGGER verification_review_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationReview" FOR EACH ROW EXECUTE FUNCTION app.verification_review_write();

ALTER TABLE "VerificationSubmission" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationSubmission" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VerificationSubmissionEvidence" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationSubmissionEvidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VerificationReview" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY submission_read ON "VerificationSubmission" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR (app.verification_permission_scope("tenantId",'verificationSubmissions.read')='ALL' AND EXISTS(SELECT 1 FROM "CustomerVerificationCase" c WHERE c."tenantId"="VerificationSubmission"."tenantId" AND c.id="caseId"))));
CREATE POLICY submission_insert ON "VerificationSubmission" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationSubmissions.create')='ALL');
CREATE POLICY selection_read ON "VerificationSubmissionEvidence" FOR SELECT USING(app.tenant_match("tenantId") AND EXISTS(SELECT 1 FROM "VerificationSubmission" s WHERE s."tenantId"="VerificationSubmissionEvidence"."tenantId" AND s.id="submissionId"));
CREATE POLICY selection_insert ON "VerificationSubmissionEvidence" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationSubmissions.create')='ALL');
CREATE POLICY review_read ON "VerificationReview" FOR SELECT USING(app.tenant_match("tenantId") AND EXISTS(SELECT 1 FROM "VerificationSubmission" s WHERE s."tenantId"="VerificationReview"."tenantId" AND s.id="submissionId"));
CREATE POLICY review_insert ON "VerificationReview" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationReviews.read')='ALL');
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT ON "VerificationSubmission","VerificationSubmissionEvidence","VerificationReview" TO %I',who); END IF; END LOOP; END $$;
COMMIT;
