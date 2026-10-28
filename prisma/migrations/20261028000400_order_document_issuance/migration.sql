BEGIN;
CREATE TABLE "BusinessDocumentTemplate" (
 "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "companyId" text NOT NULL,
 "providerKey" text NOT NULL CHECK("providerKey" ~ '^[a-z][a-z0-9.-]{1,70}$'),
 version integer NOT NULL CHECK(version>0), content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 "createdBy" text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","companyId","providerKey",version),
 FOREIGN KEY("tenantId","companyId") REFERENCES "BusinessCompany"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "SalesOrderDocument" (
 "tenantId" text NOT NULL, id text NOT NULL, "orderId" text NOT NULL,"companyId" text NOT NULL,"providerKey" text NOT NULL,"templateVersion" integer NOT NULL,
 version integer NOT NULL CHECK(version>0),reference text NOT NULL,"requestKey" text NOT NULL,"requestHash" text NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 archive jsonb NOT NULL CHECK(jsonb_typeof(archive)='object' AND archive ?& ARRAY['path','bytes','sha256','issuedAt','issuedBy'] AND coalesce((archive->>'bytes')::integer BETWEEN 1 AND 10485760 AND archive->>'sha256' ~ '^[a-f0-9]{64}$',false)),
 "supersedesId" text,reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),"createdBy" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId",id),
 FOREIGN KEY("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","companyId","providerKey","templateVersion") REFERENCES "BusinessDocumentTemplate"("tenantId","companyId","providerKey",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE("tenantId","orderId","providerKey",id),
 FOREIGN KEY("tenantId","orderId","providerKey","supersedesId") REFERENCES "SalesOrderDocument"("tenantId","orderId","providerKey",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 CHECK(("supersedesId" IS NULL AND version=1) OR ("supersedesId" IS NOT NULL AND version>1 AND length(trim(reason))>0)),
 CHECK(coalesce(snapshot->'payload'->>'reference'=reference AND snapshot->'payload'->'company'->>'id'="companyId",false)),
 CHECK(coalesce(left(archive->>'path',length("tenantId"||'/orders/'||"orderId"||'/'||id||'/'))="tenantId"||'/orders/'||"orderId"||'/'||id||'/',false)),
 CHECK(coalesce(archive->>'issuedBy'="createdBy",false))
);
CREATE UNIQUE INDEX "SalesOrderDocument_tenantId_requestKey_key" ON "SalesOrderDocument"("tenantId","requestKey");
CREATE UNIQUE INDEX "SalesOrderDocument_tenantId_reference_key" ON "SalesOrderDocument"("tenantId",reference);
CREATE UNIQUE INDEX "SalesOrderDocument_tenantId_orderId_providerKey_version_key" ON "SalesOrderDocument"("tenantId","orderId","providerKey",version);
CREATE UNIQUE INDEX "SalesOrderDocument_tenantId_supersedesId_key" ON "SalesOrderDocument"("tenantId","supersedesId");
CREATE INDEX "SalesOrderDocument_tenantId_orderId_createdAt_id_idx" ON "SalesOrderDocument"("tenantId","orderId","createdAt" DESC,id);

ALTER TABLE "BusinessDocumentTemplate" ENABLE ROW LEVEL SECURITY; ALTER TABLE "BusinessDocumentTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BusinessDocumentTemplate" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY template_admin_insert ON "BusinessDocumentTemplate" AS RESTRICTIVE FOR INSERT WITH CHECK(current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM "User" WHERE "tenantId"="BusinessDocumentTemplate"."tenantId" AND id=current_setting('app.actor_id',true) AND role='ADMIN' AND status='ACTIVE'));
CREATE TRIGGER template_immutable BEFORE UPDATE OR DELETE ON "BusinessDocumentTemplate" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event();
ALTER TABLE "SalesOrderDocument" ENABLE ROW LEVEL SECURITY; ALTER TABLE "SalesOrderDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesOrderDocument" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY document_source_read ON "SalesOrderDocument" AS RESTRICTIVE FOR SELECT USING(EXISTS(SELECT 1 FROM "SalesOrder" s WHERE s."tenantId"="SalesOrderDocument"."tenantId" AND s.id="SalesOrderDocument"."orderId"));
CREATE POLICY document_source_insert ON "SalesOrderDocument" AS RESTRICTIVE FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM "SalesOrder" s WHERE s."tenantId"="SalesOrderDocument"."tenantId" AND s.id="SalesOrderDocument"."orderId") AND app.record_sharing_allowed("tenantId",'salesOrders',"orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT'));
CREATE TRIGGER document_immutable BEFORE UPDATE OR DELETE ON "SalesOrderDocument" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event();

-- Minimal source/configuration projections; no general structure-directory grant.
-- Business action/record limits are checked by the calling service first. These
-- native projections independently retain tenant, active actor, office and
-- Restricted-source bounds and expose no grants, people or hierarchy.
CREATE FUNCTION app.document_source_issuer(t text,k text)
RETURNS TABLE(office jsonb,company jsonb) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('id',o.id,'version',o.version,'archived',o.archived),
        jsonb_build_object('id',c.id,'name',c.name,'version',c.version,'archived',c.archived)
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
CREATE FUNCTION app.document_template_companies(t text)
RETURNS TABLE(id text,name text,archived boolean) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT c.id,c.name,c.archived FROM public."BusinessCompany" c
 WHERE c."tenantId"=t AND (current_setting('app.rls_bypass',true)='on' OR (
  t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS(
   SELECT 1 FROM public."User" u JOIN public."Tenant" n ON n.id=u."tenantId"
   WHERE u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')
    AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND n.status='ACTIVE'
    AND (u.role='ADMIN' OR EXISTS(SELECT 1 FROM public."BusinessDocumentTemplate" d WHERE d."tenantId"=t AND d."companyId"=c.id)))))
$$;
REVOKE ALL ON FUNCTION app.document_source_issuer(text,text),app.document_template_companies(text) FROM PUBLIC;

CREATE FUNCTION app.document_template_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE previous integer;
BEGIN
 PERFORM 1 FROM "BusinessCompany" WHERE "tenantId"=NEW."tenantId" AND id=NEW."companyId" AND NOT archived FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active issuing company' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(version),0) INTO previous FROM "BusinessDocumentTemplate" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "providerKey"=NEW."providerKey";
 IF NEW.version<>previous+1 THEN RAISE EXCEPTION 'Template publication requires the next version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER template_version BEFORE INSERT ON "BusinessDocumentTemplate" FOR EACH ROW EXECUTE FUNCTION app.document_template_version();
CREATE FUNCTION app.document_issue_chain() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s "SalesOrder"%ROWTYPE; previous "SalesOrderDocument"%ROWTYPE; issuer text; template "BusinessDocumentTemplate"%ROWTYPE;
BEGIN
 SELECT * INTO s FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 IF s.id IS NULL OR s.status<>'CONFIRMED' OR s.reference IS NULL OR s."orderedOn" IS NULL THEN RAISE EXCEPTION 'Issue documents only from a confirmed referenced order' USING ERRCODE='23514'; END IF;
 SELECT company->>'id' INTO issuer FROM app.document_source_issuer(s."tenantId",s.id) WHERE NOT (office->>'archived')::boolean AND NOT (company->>'archived')::boolean;
 IF NEW."companyId" IS DISTINCT FROM issuer THEN RAISE EXCEPTION 'Issuing company must match the saved source office' USING ERRCODE='23514'; END IF;
 SELECT * INTO template FROM "BusinessDocumentTemplate" WHERE "tenantId"=NEW."tenantId" AND "companyId"=issuer AND "providerKey"=NEW."providerKey" ORDER BY version DESC LIMIT 1;
 IF template.version IS DISTINCT FROM NEW."templateVersion" OR NOT coalesce((template.content->>'enabled')::boolean,false) THEN RAISE EXCEPTION 'Prepare the current enabled template before issuing' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM "SalesOrderDocument" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" AND "providerKey"=NEW."providerKey" ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(previous.version,0)+1 OR NEW."supersedesId" IS DISTINCT FROM previous.id THEN RAISE EXCEPTION 'The document replacement chain changed' USING ERRCODE='23514'; END IF;
 IF left(NEW.reference,length(s.reference)+1) IS DISTINCT FROM s.reference||'/' OR right(NEW.reference,length('/'||lpad(NEW.version::text,greatest(3,length(NEW.version::text)),'0'))) IS DISTINCT FROM '/'||lpad(NEW.version::text,greatest(3,length(NEW.version::text)),'0') THEN RAISE EXCEPTION 'Document reference mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.snapshot->'payload'->>'sourceReference' IS DISTINCT FROM s.reference THEN RAISE EXCEPTION 'Document source reference mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_chain BEFORE INSERT ON "SalesOrderDocument" FOR EACH ROW EXECUTE FUNCTION app.document_issue_chain();
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
  EXECUTE format('GRANT SELECT,INSERT ON "BusinessDocumentTemplate","SalesOrderDocument" TO %I',who);
  EXECUTE format('GRANT EXECUTE ON FUNCTION app.document_source_issuer(text,text),app.document_template_companies(text) TO %I',who);
 END IF;
END LOOP; END $$;
-- No old rows, profile permissions, source policies or functions are changed.
COMMIT;
