BEGIN;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Invitation migration requires the migration owner with BYPASSRLS'; END IF;
END $$;

ALTER TABLE "Invitation" ADD COLUMN "accessConfiguration" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_accessConfiguration_object" CHECK (jsonb_typeof("accessConfiguration")='object');
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_administration ON "Invitation" AS RESTRICTIVE FOR ALL USING (
 current_setting('app.rls_bypass',true)='on' OR (
  "tenantId"=nullif(current_setting('app.tenant_id',true),'') AND EXISTS (
   SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
   WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"="Invitation"."tenantId" AND u.role='ADMIN' AND u.status='ACTIVE' AND t.status='ACTIVE'
  )
 )
);
CREATE POLICY invitation_audit_administration ON "AuditLog" AS RESTRICTIVE FOR ALL USING (
 "entityType" IS DISTINCT FROM 'Invitation' OR current_setting('app.rls_bypass',true)='on' OR (
  "tenantId"=nullif(current_setting('app.tenant_id',true),'') AND EXISTS (
   SELECT 1 FROM "User" u JOIN "Tenant" t ON t.id=u."tenantId"
   WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"="AuditLog"."tenantId" AND u.role='ADMIN' AND u.status='ACTIVE' AND t.status='ACTIVE'
  )
 )
);

-- Public onboarding can identify only a pending invitation for the exact secret
-- and current tenant. It cannot enumerate invitations or choose an administrator.
-- The service locks the tenant first; this locks the invitation in the same order
-- as revocation. It returns no token, email or access configuration.
CREATE FUNCTION app.invitation_accept_context(t text,k text) RETURNS TABLE(id text,"invitedById" text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') THEN RETURN; END IF;
 RETURN QUERY SELECT i.id,i."invitedById" FROM public."Invitation" i
 JOIN public."User" u ON u.id=i."invitedById" AND u."tenantId"=i."tenantId"
 JOIN public."Tenant" tenant ON tenant.id=i."tenantId"
 WHERE i."tenantId"=t AND i.token=k AND i."acceptedAt" IS NULL AND i."expiresAt">clock_timestamp()
  AND u.role='ADMIN' AND u.status='ACTIVE' AND tenant.status='ACTIVE'
 FOR UPDATE OF i;
END $$;
REVOKE ALL ON FUNCTION app.invitation_accept_context(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.invitation_accept_context(text,text) TO PUBLIC;

COMMIT;
