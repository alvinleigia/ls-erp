BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Office membership backfill requires the migration owner with BYPASSRLS';
  END IF;
END $$;

CREATE TABLE "BusinessOfficePolicy" (
  "tenantId" text NOT NULL,
  "userId" text NOT NULL,
  "creationOfficeId" text,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  "updatedAt" timestamp(3) NOT NULL,
  PRIMARY KEY ("tenantId","userId"),
  CONSTRAINT "BusinessOfficePolicy_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessOfficePolicy_tenantId_creationOfficeId_fkey" FOREIGN KEY ("tenantId","creationOfficeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "BusinessOfficePolicy_tenantId_creationOfficeId_idx" ON "BusinessOfficePolicy"("tenantId","creationOfficeId");
CREATE TABLE "BusinessOfficeGrant" (
  "tenantId" text NOT NULL,
  "userId" text NOT NULL,
  "officeId" text NOT NULL,
  PRIMARY KEY ("tenantId","userId","officeId"),
  CONSTRAINT "BusinessOfficeGrant_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "BusinessOfficePolicy"("tenantId","userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessOfficeGrant_tenantId_officeId_fkey" FOREIGN KEY ("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "BusinessOfficeGrant_tenantId_officeId_idx" ON "BusinessOfficeGrant"("tenantId","officeId");
CREATE TABLE "BusinessCompanyGrant" (
  "tenantId" text NOT NULL,
  "userId" text NOT NULL,
  "companyId" text NOT NULL,
  "includeSubsidiaries" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("tenantId","userId","companyId"),
  CONSTRAINT "BusinessCompanyGrant_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "BusinessOfficePolicy"("tenantId","userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessCompanyGrant_tenantId_companyId_fkey" FOREIGN KEY ("tenantId","companyId") REFERENCES "BusinessCompany"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "BusinessCompanyGrant_tenantId_companyId_idx" ON "BusinessCompanyGrant"("tenantId","companyId");

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['BusinessOfficePolicy','BusinessOfficeGrant','BusinessCompanyGrant'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY office_policy_read ON %I FOR SELECT USING (
      current_setting(''app.rls_bypass'',true)=''on'' OR (
        "tenantId"=nullif(current_setting(''app.tenant_id'',true),'''') AND EXISTS (
          SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
          WHERE u.id=nullif(current_setting(''app.actor_id'',true),'''') AND u."tenantId"="%s"."tenantId"
            AND (u.role=''ADMIN'' OR u.id="%s"."userId") AND u.status=''ACTIVE'' AND t.status=''ACTIVE''
        )
      ))',tbl,tbl,tbl);
    -- A user can change their creation preference through the narrow service;
    -- grant rows and policy creation/deletion remain administrator-only.
    EXECUTE format('CREATE POLICY office_policy_admin ON %I FOR ALL USING (
      current_setting(''app.rls_bypass'',true)=''on'' OR (
        "tenantId"=nullif(current_setting(''app.tenant_id'',true),'''') AND EXISTS (
          SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
          WHERE u.id=nullif(current_setting(''app.actor_id'',true),'''') AND u."tenantId"="%s"."tenantId"
            AND u.role=''ADMIN'' AND u.status=''ACTIVE'' AND t.status=''ACTIVE''
        )
      ))',tbl,tbl);
  END LOOP;
END $$;

-- Deliberately bound to the authenticated tenant/actor, including when called by
-- another SECURITY DEFINER function. Parent placement alone never confers access.
CREATE FUNCTION app.business_office_access(t text,o text,target_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
  SELECT t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS (
    SELECT 1 FROM public."User" caller JOIN public."Tenant" tenant ON tenant.id=caller."tenantId"
    JOIN public."User" target ON target."tenantId"=tenant.id AND target.id=target_user
    JOIN public."BusinessOffice" office ON office."tenantId"=tenant.id AND office.id=o
    JOIN public."BusinessCompany" company ON company."tenantId"=tenant.id AND company.id=office."companyId"
    WHERE tenant.id=t AND tenant.status='ACTIVE' AND caller.id=nullif(current_setting('app.actor_id',true),'')
      AND caller.status='ACTIVE' AND target.status='ACTIVE' AND (caller.id=target.id OR caller.role='ADMIN')
      AND (target.role='ADMIN'
        OR EXISTS(SELECT 1 FROM public."BusinessOfficeGrant" g WHERE g."tenantId"=t AND g."userId"=target.id AND g."officeId"=office.id)
        OR EXISTS(WITH RECURSIVE ancestors AS (
          SELECT company.id,company."parentId"
          UNION SELECT p.id,p."parentId" FROM public."BusinessCompany" p JOIN ancestors a ON p.id=a."parentId" WHERE p."tenantId"=t
        ) SELECT 1 FROM ancestors a JOIN public."BusinessCompanyGrant" g ON g."companyId"=a.id
          WHERE g."tenantId"=t AND g."userId"=target.id AND (g."includeSubsidiaries" OR a.id=company.id))
      )
  )
$$;

-- Closing an office must not silently erase authorized historical visibility.
-- Active-workspace selection is a separate, narrower eligibility check.
CREATE FUNCTION app.business_office_allowed(t text,o text,target_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
  SELECT app.business_office_access(t,o,target_user) AND EXISTS (
    SELECT 1 FROM public."BusinessOffice" office JOIN public."BusinessCompany" company ON company."tenantId"=office."tenantId" AND company.id=office."companyId"
    WHERE office."tenantId"=t AND office.id=o AND NOT office.archived AND NOT company.archived
  )
$$;

CREATE FUNCTION app.business_office_choices(t text,target_user text)
RETURNS TABLE(id text,code text,name text,"companyId" text,"companyCode" text,"companyName" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
  SELECT o.id,o.code,o.name,c.id,c.code,c.name FROM public."BusinessOffice" o
  JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId"
  WHERE o."tenantId"=t AND app.business_office_allowed(t,o.id,target_user)
$$;

-- A preference changes no membership and grants no action. Keep it atomic and
-- independently authorized rather than allowing ordinary policy-row updates.
CREATE FUNCTION app.select_creation_office(t text,o text,expected_version integer,request_id text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE actor text:=nullif(current_setting('app.actor_id',true),''); next_version integer; previous_office text; actor_role "Role";
BEGIN
  IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') THEN RAISE EXCEPTION 'Invalid tenant context' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public."Tenant" WHERE id=t FOR UPDATE;
  SELECT u.role INTO actor_role FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
    WHERE u.id=actor AND u."tenantId"=t AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF');
  IF actor_role IS NULL THEN RAISE EXCEPTION 'Workspace access is not permitted' USING ERRCODE='42501'; END IF;
  IF o IS NOT NULL AND NOT app.business_office_allowed(t,o,actor) THEN
    RAISE EXCEPTION 'Choose an accessible active office' USING ERRCODE='42501';
  END IF;
  SELECT "creationOfficeId" INTO previous_office FROM public."BusinessOfficePolicy" WHERE "tenantId"=t AND "userId"=actor;
  IF expected_version=0 THEN
    INSERT INTO public."BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") VALUES(t,actor,o,CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING RETURNING version INTO next_version;
  ELSE
    UPDATE public."BusinessOfficePolicy" SET "creationOfficeId"=o,version=version+1,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "tenantId"=t AND "userId"=actor AND version=expected_version RETURNING version INTO next_version;
  END IF;
  IF next_version IS NULL THEN RAISE EXCEPTION 'Office preference changed; reload before saving' USING ERRCODE='40001'; END IF;
  INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId",before,after)
    VALUES(gen_random_uuid()::text,t,'workspace.creationOffice.updated','BusinessOfficePolicy',actor,actor,actor_role,request_id,
      CASE WHEN expected_version=0 THEN NULL ELSE jsonb_build_object('creationOfficeId',previous_office,'version',expected_version) END,
      jsonb_build_object('creationOfficeId',o,'version',next_version));
  RETURN next_version;
END $$;

CREATE POLICY workspace_preference_audit ON "AuditLog" AS RESTRICTIVE FOR ALL USING (
  current_setting('app.rls_bypass',true)='on' OR event NOT LIKE 'workspace.%' OR EXISTS (
    SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"="AuditLog"."tenantId"
      AND (u.role='ADMIN' OR u.id="AuditLog"."actorUserId") AND u.status='ACTIVE' AND t.status='ACTIVE'
  )
);

-- Translate only organizational metadata; keep every preceding business row,
-- owner, profile, sharing grant and team membership exactly as it was. Perform
-- the backfill after table DDL so deferred FK events can finish at COMMIT.
INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt")
  SELECT u."tenantId",u.id,o.id,CURRENT_TIMESTAMP FROM "User" u JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial";
INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId")
  SELECT "tenantId","userId","creationOfficeId" FROM "BusinessOfficePolicy";

COMMIT;
