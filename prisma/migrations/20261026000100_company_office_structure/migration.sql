BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Company bootstrap requires the migration owner with BYPASSRLS';
  END IF;
END $$;

CREATE TABLE "BusinessCompany" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  "parentId" text,
  "isInitial" boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "BusinessCompany_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessCompany_identity_check" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$' AND length(btrim(name)) BETWEEN 1 AND 160 AND version > 0)
);
CREATE UNIQUE INDEX "BusinessCompany_tenantId_id_key" ON "BusinessCompany"("tenantId",id);
CREATE UNIQUE INDEX "BusinessCompany_tenantId_code_key" ON "BusinessCompany"("tenantId",code);
CREATE UNIQUE INDEX "BusinessCompany_initial_key" ON "BusinessCompany"("tenantId") WHERE "isInitial";
CREATE INDEX "BusinessCompany_tenantId_parentId_archived_idx" ON "BusinessCompany"("tenantId","parentId",archived);
ALTER TABLE "BusinessCompany" ADD CONSTRAINT "BusinessCompany_tenantId_parentId_fkey"
  FOREIGN KEY ("tenantId","parentId") REFERENCES "BusinessCompany"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "BusinessOffice" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  "companyId" text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  "isInitial" boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "BusinessOffice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BusinessOffice_tenantId_companyId_fkey" FOREIGN KEY ("tenantId","companyId") REFERENCES "BusinessCompany"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "BusinessOffice_identity_check" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$' AND length(btrim(name)) BETWEEN 1 AND 160 AND version > 0)
);
CREATE UNIQUE INDEX "BusinessOffice_tenantId_id_key" ON "BusinessOffice"("tenantId",id);
CREATE UNIQUE INDEX "BusinessOffice_tenantId_companyId_code_key" ON "BusinessOffice"("tenantId","companyId",code);
CREATE UNIQUE INDEX "BusinessOffice_initial_key" ON "BusinessOffice"("tenantId") WHERE "isInitial";
CREATE INDEX "BusinessOffice_tenantId_companyId_archived_idx" ON "BusinessOffice"("tenantId","companyId",archived);

-- Add metadata only. No existing account, permission, owner or business row changes.
INSERT INTO "BusinessCompany"(id,"tenantId",code,name,"isInitial","updatedAt")
  SELECT 'company_'||id,id,'MAIN',left(name,160),true,CURRENT_TIMESTAMP FROM "Tenant";
INSERT INTO "BusinessOffice"(id,"tenantId","companyId",code,name,"isInitial","updatedAt")
  SELECT 'office_'||id,id,'company_'||id,'MAIN','Main office',true,CURRENT_TIMESTAMP FROM "Tenant";

CREATE FUNCTION app.bootstrap_tenant_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public."BusinessCompany"(id,"tenantId",code,name,"isInitial","updatedAt")
    VALUES('company_'||NEW.id,NEW.id,'MAIN',left(NEW.name,160),true,CURRENT_TIMESTAMP);
  INSERT INTO public."BusinessOffice"(id,"tenantId","companyId",code,name,"isInitial","updatedAt")
    VALUES('office_'||NEW.id,NEW.id,'company_'||NEW.id,'MAIN','Main office',true,CURRENT_TIMESTAMP);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.bootstrap_tenant_company() FROM PUBLIC;
CREATE TRIGGER tenant_company_bootstrap AFTER INSERT ON "Tenant" FOR EACH ROW EXECUTE FUNCTION app.bootstrap_tenant_company();

-- Serialize hierarchy edits with account/security administration. Reject cycles
-- and invalid archive/reparent operations even when SQL bypasses the HTTP service.
CREATE FUNCTION app.guard_company_structure() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public."Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
    OR NEW.code IS DISTINCT FROM OLD.code OR NEW."isInitial" IS DISTINCT FROM OLD."isInitial") THEN
    RAISE EXCEPTION 'Structure identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='BusinessCompany' THEN
    IF NEW."isInitial" AND NEW.archived THEN
      RAISE EXCEPTION 'Keep the initial company active' USING ERRCODE='23514';
    END IF;
    IF NEW."parentId" IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public."BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND id=NEW."parentId" AND NOT archived) THEN
        RAISE EXCEPTION 'Choose an active parent company in this tenant' USING ERRCODE='23514';
      END IF;
      IF EXISTS (WITH RECURSIVE ancestors AS (
        SELECT id,"parentId" FROM public."BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND id=NEW."parentId"
        UNION SELECT p.id,p."parentId" FROM public."BusinessCompany" p JOIN ancestors a ON p.id=a."parentId" WHERE p."tenantId"=NEW."tenantId"
      ) SELECT 1 FROM ancestors WHERE id=NEW.id) OR NEW."parentId"=NEW.id THEN
        RAISE EXCEPTION 'Company hierarchy cannot contain a cycle' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.archived AND (EXISTS (SELECT 1 FROM public."BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND "parentId"=NEW.id AND NOT archived)
      OR EXISTS (SELECT 1 FROM public."BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW.id AND NOT archived)) THEN
      RAISE EXCEPTION 'Archive active subsidiaries and offices first' USING ERRCODE='23514';
    END IF;
  ELSE
    IF TG_OP='UPDATE' AND NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
      RAISE EXCEPTION 'An office cannot be moved to another company' USING ERRCODE='23514';
    END IF;
    IF NEW."isInitial" AND (NEW.archived OR NOT EXISTS (SELECT 1 FROM public."BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND id=NEW."companyId" AND "isInitial")) THEN
      RAISE EXCEPTION 'Keep the initial office active in the initial company' USING ERRCODE='23514';
    END IF;
    IF NOT NEW.archived AND NOT EXISTS (SELECT 1 FROM public."BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND id=NEW."companyId" AND NOT archived) THEN
      RAISE EXCEPTION 'Choose an active company in this tenant' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_company_structure() FROM PUBLIC;
CREATE TRIGGER company_structure_guard BEFORE INSERT OR UPDATE ON "BusinessCompany" FOR EACH ROW EXECUTE FUNCTION app.guard_company_structure();
CREATE TRIGGER office_structure_guard BEFORE INSERT OR UPDATE ON "BusinessOffice" FOR EACH ROW EXECUTE FUNCTION app.guard_company_structure();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['BusinessCompany','BusinessOffice'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
    EXECUTE format('CREATE POLICY structure_admin ON %I FOR ALL USING (
      current_setting(''app.rls_bypass'',true)=''on'' OR (
        "tenantId"=nullif(current_setting(''app.tenant_id'',true),'''') AND EXISTS (
          SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
          WHERE u.id=nullif(current_setting(''app.actor_id'',true),'''') AND u."tenantId"="%s"."tenantId"
            AND u.role=''ADMIN'' AND u.status=''ACTIVE'' AND t.status=''ACTIVE''
        )
      ))',tbl,tbl);
    EXECUTE format('CREATE POLICY structure_no_delete ON %I AS RESTRICTIVE FOR DELETE USING (current_setting(''app.rls_bypass'',true)=''on'')',tbl);
  END LOOP;
END $$;

-- A general audit profile must not reveal this administrator-only directory.
CREATE POLICY company_structure_audit ON "AuditLog" AS RESTRICTIVE FOR ALL USING (
  current_setting('app.rls_bypass',true)='on' OR event NOT LIKE 'structure.%' OR EXISTS (
    SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"="AuditLog"."tenantId"
      AND u.role='ADMIN' AND u.status='ACTIVE' AND t.status='ACTIVE'
  )
);

COMMIT;
