BEGIN;
-- Additive only: no tenant activation, profile grants, identity backfill or
-- booking/payment gates. A started case is never an approved verification.
CREATE FUNCTION app.verification_policy_valid(d jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb; category text; codes text[]; values_count integer;
BEGIN
 IF jsonb_typeof(d)<>'object' OR NOT d ?& ARRAY['format','facts','documents','validityDays','preventSelfApproval'] OR d-ARRAY['format','facts','documents','validityDays','preventSelfApproval']<>'{}'::jsonb OR d->'format'<>'1'::jsonb OR d->'preventSelfApproval'<>'true'::jsonb OR octet_length(d::text)>65536 THEN RETURN false; END IF;
 IF d->'validityDays'<>'null'::jsonb AND (jsonb_typeof(d->'validityDays')<>'number' OR (d->>'validityDays')::numeric NOT BETWEEN 1 AND 3650 OR trunc((d->>'validityDays')::numeric)<>(d->>'validityDays')::numeric) THEN RETURN false; END IF;
 FOREACH category IN ARRAY ARRAY['facts','documents'] LOOP
  IF jsonb_typeof(d->category)<>'array' OR jsonb_array_length(d->category)>(CASE WHEN category='facts' THEN 30 ELSE 20 END) THEN RETURN false; END IF;
  codes:=ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(d->category) LOOP
   IF jsonb_typeof(r)<>'object' OR NOT r ?& ARRAY['code','label','subjects','roles'] OR (category='facts' AND NOT r ? 'type') OR r-(CASE WHEN category='facts' THEN ARRAY['code','label','subjects','roles','type'] ELSE ARRAY['code','label','subjects','roles'] END)<>'{}'::jsonb THEN RETURN false; END IF;
   IF jsonb_typeof(r->'code')<>'string' OR r->>'code' !~ '^[a-z][a-z0-9_]{0,39}$' OR r->>'code'=ANY(codes) OR jsonb_typeof(r->'label')<>'string' OR length(btrim(r->>'label')) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
   codes:=array_append(codes,r->>'code');
   IF category='facts' AND (jsonb_typeof(r->'type')<>'string' OR r->>'type' NOT IN ('TEXT','DATE','EMAIL','COUNTRY')) THEN RETURN false; END IF;
   IF jsonb_typeof(r->'subjects')<>'array' OR jsonb_array_length(r->'subjects') NOT BETWEEN 1 AND 2 OR NOT (r->'subjects' <@ '["PERSON","BUSINESS"]'::jsonb) OR jsonb_typeof(r->'roles')<>'array' OR jsonb_array_length(r->'roles') NOT BETWEEN 1 AND 3 OR NOT (r->'roles' <@ '["CUSTOMER","ADDITIONAL_CUSTOMER","REPRESENTATIVE"]'::jsonb) THEN RETURN false; END IF;
   SELECT count(DISTINCT value) INTO values_count FROM jsonb_array_elements(r->'subjects');
   IF values_count<>jsonb_array_length(r->'subjects') THEN RETURN false; END IF;
   SELECT count(DISTINCT value) INTO values_count FROM jsonb_array_elements(r->'roles');
   IF values_count<>jsonb_array_length(r->'roles') THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE TABLE "VerificationPolicyVersion" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 version integer NOT NULL CHECK(version>0), definition jsonb NOT NULL CHECK(app.verification_policy_valid(definition)),
 "publishedByUserId" text NOT NULL, "publishedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId",version), FOREIGN KEY("tenantId","publishedByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CustomerVerificationCase" (
 id text PRIMARY KEY, "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "contactId" text, "accountId" text, "policyVersion" integer NOT NULL,
 "createdByUserId" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(num_nonnulls("contactId","accountId")=1),
 UNIQUE("tenantId",id), UNIQUE("tenantId","contactId"), UNIQUE("tenantId","accountId"),
 FOREIGN KEY("tenantId","contactId") REFERENCES "CrmContact"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","accountId") REFERENCES "CrmAccount"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","policyVersion") REFERENCES "VerificationPolicyVersion"("tenantId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","createdByUserId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Closed, fresh capability resolution; no partner-specific or industry dependency.
CREATE FUNCTION app.verification_permission_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE COALESCE(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
 AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND u."collaboratorId" IS NULL
 AND p IN ('verificationPolicies.read','verificationPolicies.edit','customerVerification.read','customerVerification.create','contacts.read','accounts.read')
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='crm' AND m.allowed AND m.enabled)
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='customerVerification' AND m.allowed AND m.enabled)
 AND (u.role='ADMIN' OR (
 EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions))
 AND COALESCE(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
$$;

-- SECURITY INVOKER retains parent RLS. Scope checks additionally prevent a
-- raw case query from bypassing Own/Related/Managed-team directory limits.
CREATE FUNCTION app.verification_shared(t text,r text,k text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "RecordSharingPolicy" p JOIN "RecordSharingGrant" g ON g."tenantId"=p."tenantId" AND g."policyId"=p.id
 WHERE p."tenantId"=t AND p.resource=r AND p."recordId"=k AND (g."userId"=nullif(current_setting('app.actor_id',true),'') OR EXISTS(
 SELECT 1 FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId" AND NOT team.archived
 WHERE m."tenantId"=t AND m."teamId"=g."teamId" AND m."userId"=nullif(current_setting('app.actor_id',true),''))))
$$;
CREATE FUNCTION app.verification_sales_visible(t text,k text,assigned text,team_id text,r text,s text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT assigned=nullif(current_setting('app.actor_id',true),'') OR s='ALL' OR (s='MANAGED_TEAMS' AND EXISTS(
 SELECT 1 FROM "BusinessTeamMember" m JOIN "BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId" AND NOT team.archived
 WHERE m."tenantId"=t AND m."teamId"=team_id AND m."isManager" AND m."userId"=nullif(current_setting('app.actor_id',true),''))) OR app.verification_shared(t,r,k)
$$;
CREATE FUNCTION app.verification_contact_visible(t text,k text,r text DEFAULT 'contacts') RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE s text:=app.verification_permission_scope(t,r||'.read'); u text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF s IS NULL OR s NOT IN ('OWN','RELATED','MANAGED_TEAMS','ALL') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM "CrmContact" c WHERE c."tenantId"=t AND c.id=k AND (
 c."ownerUserId"=u OR s='ALL' OR (r='contacts' AND app.verification_shared(t,r,k)) OR (s<>'OWN' AND (
 EXISTS(SELECT 1 FROM "CrmEnquiry" e WHERE e."tenantId"=t AND e."contactId"=k AND app.verification_sales_visible(t,e.id,e."assignedUserId",e."salesTeamId",'enquiries',s)) OR
 EXISTS(SELECT 1 FROM "CrmOpportunity" o WHERE o."tenantId"=t AND o."contactId"=k AND app.verification_sales_visible(t,o.id,o."assignedUserId",o."salesTeamId",'opportunities',s)) OR
 EXISTS(SELECT 1 FROM "CrmTask" w WHERE w."tenantId"=t AND w."contactId"=k AND w."assignedUserId"=u AND w.status IN ('OPEN','IN_PROGRESS'))))));
END $$;
CREATE FUNCTION app.verification_subject_visible(t text,c text,b text) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE s text; u text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF c IS NOT NULL THEN RETURN app.verification_contact_visible(t,c); END IF;
 s:=app.verification_permission_scope(t,'accounts.read');
 IF s IS NULL OR s NOT IN ('OWN','RELATED','MANAGED_TEAMS','ALL') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM "CrmAccount" a WHERE a."tenantId"=t AND a.id=b AND (a."ownerUserId"=u OR s='ALL' OR app.verification_shared(t,'accounts',b) OR (s<>'OWN' AND (
 EXISTS(SELECT 1 FROM "CrmOpportunity" o WHERE o."tenantId"=t AND o."accountId"=b AND app.verification_sales_visible(t,o.id,o."assignedUserId",o."salesTeamId",'opportunities',s)) OR
 EXISTS(SELECT 1 FROM "CrmAccountContact" l WHERE l."tenantId"=t AND l."accountId"=b AND app.verification_contact_visible(t,l."contactId") AND app.verification_contact_visible(t,l."contactId",'accounts'))))));
END $$;

CREATE FUNCTION app.verification_foundation_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Verification policy history and case identity are immutable' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 IF TG_TABLE_NAME='VerificationPolicyVersion' THEN
  IF NOT EXISTS(SELECT 1 FROM "User" WHERE "tenantId"=NEW."tenantId" AND id=nullif(current_setting('app.actor_id',true),'') AND role='ADMIN' AND status='ACTIVE' AND "collaboratorId" IS NULL) OR app.verification_permission_scope(NEW."tenantId",'verificationPolicies.edit') IS DISTINCT FROM 'ALL' OR NEW."publishedByUserId" IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') THEN RAISE EXCEPTION 'Verification policy publication is not permitted' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(version),0) INTO current_version FROM "VerificationPolicyVersion" WHERE "tenantId"=NEW."tenantId";
  IF NEW.version<>current_version+1 THEN RAISE EXCEPTION 'Publish the next verification policy version' USING ERRCODE='23514'; END IF;
  NEW."publishedAt":=statement_timestamp();
 ELSE
  IF app.verification_permission_scope(NEW."tenantId",'customerVerification.create') IS DISTINCT FROM 'ALL' OR app.verification_permission_scope(NEW."tenantId",'customerVerification.read') IS DISTINCT FROM 'ALL' OR NOT app.verification_subject_visible(NEW."tenantId",NEW."contactId",NEW."accountId") OR NEW."createdByUserId" IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') THEN RAISE EXCEPTION 'Customer verification collection is not permitted' USING ERRCODE='42501'; END IF;
  -- Collectors need not browse policy administration. Read the current version
  -- through a bounded helper; no policy evidence or private facts are returned.
  current_version:=app.verification_latest_version(NEW."tenantId");
  IF NEW."policyVersion" IS DISTINCT FROM current_version OR current_version IS NULL OR EXISTS(SELECT 1 FROM "CrmContact" WHERE "tenantId"=NEW."tenantId" AND id=NEW."contactId" AND archived) OR EXISTS(SELECT 1 FROM "CrmAccount" WHERE "tenantId"=NEW."tenantId" AND id=NEW."accountId" AND archived) THEN RAISE EXCEPTION 'Choose an active customer and current verification policy' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=statement_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION app.verification_latest_version(t text) RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT max(version) FROM public."VerificationPolicyVersion" WHERE "tenantId"=t AND t=nullif(current_setting('app.tenant_id',true),'') AND app.verification_permission_scope(t,'customerVerification.read')='ALL'
$$;
CREATE TRIGGER verification_policy_write BEFORE INSERT OR UPDATE OR DELETE ON "VerificationPolicyVersion" FOR EACH ROW EXECUTE FUNCTION app.verification_foundation_write();
CREATE TRIGGER verification_case_write BEFORE INSERT OR UPDATE OR DELETE ON "CustomerVerificationCase" FOR EACH ROW EXECUTE FUNCTION app.verification_foundation_write();
ALTER TABLE "VerificationPolicyVersion" ENABLE ROW LEVEL SECURITY; ALTER TABLE "VerificationPolicyVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomerVerificationCase" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CustomerVerificationCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_policy_read ON "VerificationPolicyVersion" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR app.verification_permission_scope("tenantId",'verificationPolicies.read')='ALL'));
CREATE POLICY verification_policy_insert ON "VerificationPolicyVersion" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'verificationPolicies.edit')='ALL');
CREATE POLICY verification_case_read ON "CustomerVerificationCase" FOR SELECT USING(app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR (app.verification_permission_scope("tenantId",'customerVerification.read')='ALL' AND app.verification_subject_visible("tenantId","contactId","accountId"))));
CREATE POLICY verification_case_insert ON "CustomerVerificationCase" FOR INSERT WITH CHECK(app.tenant_match("tenantId") AND app.verification_permission_scope("tenantId",'customerVerification.create')='ALL' AND app.verification_subject_visible("tenantId","contactId","accountId"));
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT ON "VerificationPolicyVersion","CustomerVerificationCase" TO %I',who); END IF; END LOOP; END $$;
COMMIT;
