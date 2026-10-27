BEGIN;
CREATE TABLE "ExternalCollaborator" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  classification text NOT NULL DEFAULT 'Partner',
  "organizationName" text,
  email text,
  phone text,
  "supervisorUserId" text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "ExternalCollaborator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExternalCollaborator_tenantId_supervisorUserId_fkey" FOREIGN KEY ("tenantId","supervisorUserId") REFERENCES "User"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "ExternalCollaborator_fields_check" CHECK (
    code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$' AND length(btrim(name)) BETWEEN 1 AND 160
    AND length(btrim(classification)) BETWEEN 1 AND 80 AND version > 0
    AND ("organizationName" IS NULL OR length(btrim("organizationName")) BETWEEN 1 AND 160)
    AND (email IS NULL OR length(email) BETWEEN 3 AND 254)
    AND (phone IS NULL OR length(btrim(phone)) BETWEEN 1 AND 40))
);
CREATE UNIQUE INDEX "ExternalCollaborator_tenantId_id_key" ON "ExternalCollaborator"("tenantId",id);
CREATE UNIQUE INDEX "ExternalCollaborator_tenantId_code_key" ON "ExternalCollaborator"("tenantId",code);
CREATE INDEX "ExternalCollaborator_tenantId_archived_name_idx" ON "ExternalCollaborator"("tenantId",archived,name);
CREATE INDEX "ExternalCollaborator_tenantId_supervisorUserId_idx" ON "ExternalCollaborator"("tenantId","supervisorUserId");

-- This is metadata only: no account, employment, source, grant or KPI backfill.
CREATE FUNCTION app.guard_external_collaborator() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public."Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW.code IS DISTINCT FROM OLD.code) THEN
    RAISE EXCEPTION 'Collaborator identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' OR NEW."supervisorUserId" IS DISTINCT FROM OLD."supervisorUserId" OR (OLD.archived AND NOT NEW.archived) THEN
    IF NOT EXISTS (SELECT 1 FROM public."User" WHERE id=NEW."supervisorUserId" AND "tenantId"=NEW."tenantId" AND status='ACTIVE' AND role IN ('ADMIN','MANAGER')) THEN
      RAISE EXCEPTION 'Choose an active internal administrator or manager in this workspace' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_external_collaborator() FROM PUBLIC;
CREATE TRIGGER external_collaborator_guard BEFORE INSERT OR UPDATE ON "ExternalCollaborator" FOR EACH ROW EXECUTE FUNCTION app.guard_external_collaborator();
ALTER TABLE "ExternalCollaborator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalCollaborator" FORCE ROW LEVEL SECURITY;
CREATE POLICY collaborator_admin ON "ExternalCollaborator" FOR ALL USING (
  current_setting('app.rls_bypass',true)='on' OR (
    "tenantId"=nullif(current_setting('app.tenant_id',true),'') AND EXISTS (
      SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
      WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"="ExternalCollaborator"."tenantId"
        AND u.role='ADMIN' AND u.status='ACTIVE' AND t.status='ACTIVE'
    )
  )
);
CREATE POLICY collaborator_no_delete ON "ExternalCollaborator" AS RESTRICTIVE FOR DELETE USING (current_setting('app.rls_bypass',true)='on');
CREATE POLICY collaborator_private_audit ON "AuditLog" AS RESTRICTIVE FOR ALL USING (
  current_setting('app.rls_bypass',true)='on' OR (event NOT LIKE 'collaborator.%' AND "entityType"<>'ExternalCollaborator') OR EXISTS (
    SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
    WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"="AuditLog"."tenantId"
      AND u.role='ADMIN' AND u.status='ACTIVE' AND t.status='ACTIVE'
  )
);
COMMIT;
