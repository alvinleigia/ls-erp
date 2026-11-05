BEGIN;
ALTER TABLE "BusinessCompany" ADD COLUMN "documentSettings" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "BusinessCompany" ADD CONSTRAINT company_document_settings_object CHECK (jsonb_typeof("documentSettings")='object');
-- Existing directory RLS and administrator-only writes remain authoritative.
CREATE FUNCTION app.office_document_defaults(t text,k text)
RETURNS TABLE(id text,name text,settings jsonb) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT c.id,c.name,c."documentSettings" FROM public."BusinessOffice" o
 JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId"
 WHERE o."tenantId"=t AND o.id=k AND NOT o.archived AND NOT c.archived
 AND (current_setting('app.rls_bypass',true)='on' OR (
  t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS(
   SELECT 1 FROM public."User" u JOIN public."Tenant" n ON n.id=u."tenantId"
   WHERE u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
    AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND n.status='ACTIVE')
  AND app.business_office_access(t,k,nullif(current_setting('app.actor_id',true),''))))
$$;
REVOKE ALL ON FUNCTION app.office_document_defaults(text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION app.document_source_issuer(t text,k text)
RETURNS TABLE(office jsonb,company jsonb) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('id',o.id,'version',o.version,'archived',o.archived),
        jsonb_build_object('id',c.id,'name',c.name,'version',c.version,'archived',c.archived,'documentSettings',c."documentSettings")
 FROM public."SalesOrder" s
 JOIN public."CrmQuotation" q ON q."tenantId"=s."tenantId" AND q.id=s."quotationId"
 JOIN public."CrmOpportunity" p ON p."tenantId"=q."tenantId" AND p.id=q."opportunityId"
 JOIN public."BusinessOffice" o ON o."tenantId"=p."tenantId" AND o.id=p."officeId"
 JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId"
 WHERE s."tenantId"=t AND s.id=k AND (current_setting('app.rls_bypass',true)='on' OR (
  t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS(
   SELECT 1 FROM public."User" u JOIN public."Tenant" n ON n.id=u."tenantId"
   WHERE u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
    AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND n.status='ACTIVE')
  AND app.record_office_allowed(t,'salesOrders',k,nullif(current_setting('app.actor_id',true),''))
  AND app.record_sharing_allowed(t,'salesOrders',k,nullif(current_setting('app.actor_id',true),''),'READ')))
$$;
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION app.office_document_defaults(text,text) TO %I',who);
 END IF;
END LOOP; END $$;
-- No accepted quotation/order snapshots or issued document bytes are rewritten.
COMMIT;
