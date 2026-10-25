BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Office ownership migration requires BYPASSRLS'; END IF; END $$;

CREATE FUNCTION app.creation_office_id() RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('app.office_id',true),'')
$$;

ALTER TABLE "CrmEnquiry" ADD COLUMN "importId" text;
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_importId_fkey" FOREIGN KEY("tenantId","importId") REFERENCES "CrmEnquiryImport"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CrmEnquiry_tenantId_importId_idx" ON "CrmEnquiry"("tenantId","importId");

-- Disable only the timestamp-changing bridge during this transaction's backfill.
-- Rollback restores both the old data and the original trigger state.
ALTER TABLE "CrmTask" DISABLE TRIGGER crm_task_legacy_bridge;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['CrmEnquiry','CrmOpportunity','CrmTask','RealEstateProject','CrmEnquiryImport','CrmPlanLaunch'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN "officeId" text',tbl);
  EXECUTE format('UPDATE %I r SET "officeId"=o.id FROM "BusinessOffice" o WHERE o."tenantId"=r."tenantId" AND o."isInitial"',tbl);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN "officeId" SET NOT NULL, ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id()',tbl);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED',tbl,tbl||'_tenantId_officeId_fkey');
  EXECUTE format('CREATE INDEX %I ON %I("tenantId","officeId")',tbl||'_tenantId_officeId_idx',tbl);
 END LOOP;
END $$;
ALTER TABLE "CrmTask" ENABLE TRIGGER crm_task_legacy_bridge;

-- Private helper for definer guards. It returns eligibility only, never user or
-- record data. Public helpers retain authenticated tenant/actor binding.
CREATE FUNCTION app.office_membership_exists(t text,o text,target_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."User" target JOIN public."Tenant" tenant ON tenant.id=target."tenantId"
 JOIN public."BusinessOffice" office ON office."tenantId"=tenant.id AND office.id=o
 JOIN public."BusinessCompany" company ON company."tenantId"=tenant.id AND company.id=office."companyId"
 WHERE tenant.id=t AND tenant.status='ACTIVE' AND target.id=target_user AND target.status='ACTIVE' AND (
  target.role='ADMIN' OR EXISTS(SELECT 1 FROM public."BusinessOfficeGrant" g WHERE g."tenantId"=t AND g."userId"=target.id AND g."officeId"=o)
  OR EXISTS(WITH RECURSIVE ancestors AS (SELECT company.id,company."parentId" UNION SELECT p.id,p."parentId" FROM public."BusinessCompany" p JOIN ancestors a ON p.id=a."parentId" WHERE p."tenantId"=t)
   SELECT 1 FROM ancestors a JOIN public."BusinessCompanyGrant" g ON g."companyId"=a.id WHERE g."tenantId"=t AND g."userId"=target.id AND (g."includeSubsidiaries" OR a.id=company.id))
 ))
$$;
REVOKE ALL ON FUNCTION app.office_membership_exists(text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.business_office_access(t text,o text,target_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS(SELECT 1 FROM public."User" caller JOIN public."Tenant" tenant ON tenant.id=caller."tenantId"
  WHERE caller.id=nullif(current_setting('app.actor_id',true),'') AND caller."tenantId"=t AND caller.status='ACTIVE' AND tenant.status='ACTIVE' AND (caller.id=target_user OR caller.role='ADMIN'))
  AND app.office_membership_exists(t,o,target_user)
$$;

CREATE FUNCTION app.office_assignment_allowed(t text,o text,target_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),'')) AND app.office_membership_exists(t,o,target_user)
$$;

-- Canonical source lookup, callable only by the guards below. The table names
-- are a closed registry, not identifiers accepted from requests.
CREATE FUNCTION app.native_record_office(t text,kind text,k text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE result text; parent text;
BEGIN
 IF k IS NULL OR k='' THEN RETURN NULL; END IF;
 IF kind IN ('CrmEnquiry','CrmOpportunity','CrmTask','RealEstateProject','CrmEnquiryImport','CrmPlanLaunch') THEN
  EXECUTE format('SELECT "officeId" FROM public.%I WHERE "tenantId"=$1 AND id=$2',kind) INTO result USING t,k;
  RETURN result;
 END IF;
 CASE kind
 WHEN 'CrmQuotation' THEN SELECT "opportunityId" INTO parent FROM public."CrmQuotation" WHERE "tenantId"=t AND id=k; RETURN app.native_record_office(t,'CrmOpportunity',parent);
 WHEN 'SalesOrder' THEN SELECT "quotationId" INTO parent FROM public."SalesOrder" WHERE "tenantId"=t AND id=k; RETURN app.native_record_office(t,'CrmQuotation',parent);
 WHEN 'UnitReservation' THEN SELECT "orderId" INTO parent FROM public."UnitReservation" WHERE "tenantId"=t AND id=k; RETURN app.native_record_office(t,'SalesOrder',parent);
 WHEN 'CatalogItem' THEN SELECT "projectId" INTO parent FROM public."RealEstateUnit" WHERE "tenantId"=t AND "itemId"=k; RETURN app.native_record_office(t,'RealEstateProject',parent);
 ELSE RETURN NULL;
 END CASE;
END $$;
REVOKE ALL ON FUNCTION app.native_record_office(text,text,text) FROM PUBLIC;

CREATE FUNCTION app.record_office_allowed(t text,r text,k text,u text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE kind text; office text; parent text; linked text;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' THEN RETURN true; END IF;
 IF k IS NULL OR k='' THEN RETURN true; END IF;
 IF r IN ('contacts','accounts') THEN RETURN true; END IF; -- shared parties, still bounded by their existing privacy/action policies
 IF r='catalogItems' THEN
  SELECT "projectId" INTO parent FROM public."RealEstateUnit" WHERE "tenantId"=t AND "itemId"=k;
  IF parent IS NULL THEN RETURN true; END IF; -- general sales catalog is shared reference data
  RETURN app.record_office_allowed(t,'projects',parent,u);
 END IF;
 kind:=CASE r WHEN 'enquiries' THEN 'CrmEnquiry' WHEN 'opportunities' THEN 'CrmOpportunity' WHEN 'activities' THEN 'CrmTask' WHEN 'projects' THEN 'RealEstateProject' WHEN 'quotations' THEN 'CrmQuotation' WHEN 'salesOrders' THEN 'SalesOrder' WHEN 'receivables' THEN 'SalesOrder' WHEN 'orderPayments' THEN 'SalesOrder' WHEN 'unitReservations' THEN 'UnitReservation' WHEN 'enquiryImports' THEN 'CrmEnquiryImport' WHEN 'planLaunches' THEN 'CrmPlanLaunch' END;
 IF kind IS NULL THEN RETURN false; END IF;
 office:=app.native_record_office(t,kind,k);
 IF office IS NULL OR NOT app.business_office_access(t,office,u) THEN RETURN false; END IF;
 IF r='unitReservations' THEN
  SELECT "itemId" INTO linked FROM public."UnitReservation" WHERE "tenantId"=t AND id=k;
  RETURN app.record_office_allowed(t,'catalogItems',linked,u);
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION app.native_office_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE doc jsonb:=to_jsonb(NEW); old_doc jsonb; t text:=doc->>'tenantId'; u text:=nullif(current_setting('app.actor_id',true),''); source_office text; candidate text; ref record; refs jsonb:='[]'; maintenance boolean; expected_version text;
BEGIN
 maintenance:=current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls));
 IF TG_OP='UPDATE' THEN
  old_doc:=to_jsonb(OLD);
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW.id IS DISTINCT FROM OLD.id OR NEW."officeId" IS DISTINCT FROM OLD."officeId" THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 CASE TG_TABLE_NAME
 WHEN 'CrmEnquiry' THEN
  IF TG_OP='UPDATE' AND doc->>'importId' IS DISTINCT FROM old_doc->>'importId' THEN RAISE EXCEPTION 'Import provenance is immutable' USING ERRCODE='23514'; END IF;
  refs:=jsonb_build_array(jsonb_build_object('kind','CrmEnquiryImport','id',doc->>'importId'));
 WHEN 'CrmOpportunity' THEN refs:=jsonb_build_array(jsonb_build_object('kind','CrmEnquiry','id',doc->>'enquiryId'));
 WHEN 'RealEstateProject' THEN refs:=jsonb_build_array(jsonb_build_object('kind','RealEstateProject','id',doc->>'parentId'));
 WHEN 'CrmTask' THEN refs:=jsonb_build_array(jsonb_build_object('kind','CrmEnquiry','id',doc->>'enquiryId'),jsonb_build_object('kind','CrmOpportunity','id',doc->>'opportunityId'),jsonb_build_object('kind','SalesOrder','id',doc->>'collectionOrderId'),jsonb_build_object('kind','CrmTask','id',doc->>'followUpOfId'),jsonb_build_object('kind','CrmPlanLaunch','id',doc->>'planLaunchId'));
 WHEN 'CrmPlanLaunch' THEN refs:=jsonb_build_array(jsonb_build_object('kind','CrmEnquiry','id',doc->'input'->>'enquiryId'),jsonb_build_object('kind','CrmOpportunity','id',doc->'input'->>'opportunityId'));
 ELSE NULL;
 END CASE;
 FOR ref IN SELECT value->>'kind' kind,value->>'id' id FROM jsonb_array_elements(refs) LOOP
  IF ref.id IS NOT NULL AND ref.id<>'' THEN
   candidate:=app.native_record_office(t,ref.kind,ref.id);
   IF candidate IS NULL THEN RAISE EXCEPTION 'Choose an accessible source record' USING ERRCODE='23503'; END IF;
   IF source_office IS NOT NULL AND source_office<>candidate THEN RAISE EXCEPTION 'Linked records must belong to the same office' USING ERRCODE='23514'; END IF;
   source_office:=candidate;
  END IF;
 END LOOP;
 IF source_office IS NOT NULL THEN
  IF TG_OP='UPDATE' AND source_office<>OLD."officeId" THEN RAISE EXCEPTION 'A linked source cannot change the record office' USING ERRCODE='23514'; END IF;
  NEW."officeId":=source_office;
 ELSIF TG_OP='INSERT' AND NOT maintenance THEN
  expected_version:=nullif(current_setting('app.office_version',true),'');
  IF NEW."officeId" IS NULL OR NEW."officeId" IS DISTINCT FROM app.creation_office_id() OR expected_version IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=u AND p."creationOfficeId"=NEW."officeId" AND p.version::text=expected_version) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001'; END IF;
  IF NOT app.business_office_allowed(t,NEW."officeId",u) THEN RAISE EXCEPTION 'Office creation access is not permitted' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT maintenance AND NOT app.business_office_access(t,NEW."officeId",u) THEN RAISE EXCEPTION 'Record office access is not permitted' USING ERRCODE='42501'; END IF;
 IF NOT maintenance AND doc ? 'assignedUserId' AND (TG_OP='INSERT' OR doc->>'assignedUserId' IS DISTINCT FROM old_doc->>'assignedUserId') AND NOT app.office_membership_exists(t,NEW."officeId",doc->>'assignedUserId') THEN RAISE EXCEPTION 'Choose an assignee with access to this office' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.native_office_owner() FROM PUBLIC;

-- Non-correlated RLS initplan: resolve the actor's office set once per statement,
-- rather than walking company grants again for every business row.
CREATE FUNCTION app.office_scope_ids() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT COALESCE(array_agg(o.id),'{}'::text[]) FROM public."BusinessOffice" o
 WHERE o."tenantId"=nullif(current_setting('app.tenant_id',true),'') AND app.business_office_access(o."tenantId",o.id,nullif(current_setting('app.actor_id',true),''))
$$;

DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['CrmEnquiry','CrmOpportunity','CrmTask','RealEstateProject','CrmEnquiryImport','CrmPlanLaunch'] LOOP
  EXECUTE format('CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.native_office_owner()',tbl);
  EXECUTE format('CREATE POLICY office_isolation ON %I AS RESTRICTIVE FOR ALL USING (current_setting(''app.rls_bypass'',true)=''on'' OR "officeId"=ANY((SELECT app.office_scope_ids())::text[]))',tbl);
 END LOOP;
END $$;

-- Generic extension invariant: references to office-owned sources cannot join
-- two offices into one workflow. Parties/catalog definitions remain shared.
CREATE FUNCTION app.office_reference_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE doc jsonb:=to_jsonb(NEW); a text; b text;
BEGIN
 IF doc->>TG_ARGV[1] IS NULL OR doc->>TG_ARGV[3] IS NULL THEN RETURN NEW; END IF;
 a:=app.native_record_office(doc->>'tenantId',TG_ARGV[0],doc->>TG_ARGV[1]); b:=app.native_record_office(doc->>'tenantId',TG_ARGV[2],doc->>TG_ARGV[3]);
 -- Missing/foreign parents are rejected by the existing composite foreign keys.
 IF a IS NOT NULL AND b IS NOT NULL AND a<>b THEN RAISE EXCEPTION 'Linked records must belong to the same office' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.office_reference_guard() FROM PUBLIC;
CREATE TRIGGER office_reference BEFORE INSERT OR UPDATE ON "RealEstateEnquiryContext" FOR EACH ROW EXECUTE FUNCTION app.office_reference_guard('CrmEnquiry','enquiryId','RealEstateProject','projectId');
CREATE TRIGGER office_reference BEFORE INSERT OR UPDATE ON "RealEstateOpportunityContext" FOR EACH ROW EXECUTE FUNCTION app.office_reference_guard('CrmOpportunity','opportunityId','RealEstateProject','projectId');

CREATE FUNCTION app.office_project_member() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 IF current_setting('app.rls_bypass',true) IS DISTINCT FROM 'on' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) AND NOT app.office_membership_exists(NEW."tenantId",app.native_record_office(NEW."tenantId",'RealEstateProject',NEW."projectId"),NEW."userId") THEN RAISE EXCEPTION 'Choose an assignee with access to this office' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER office_member BEFORE INSERT OR UPDATE ON "RealEstateProjectMember" FOR EACH ROW EXECUTE FUNCTION app.office_project_member();

CREATE FUNCTION app.quotation_office_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW.id IS DISTINCT FROM OLD.id OR NEW."opportunityId" IS DISTINCT FROM OLD."opportunityId" THEN RAISE EXCEPTION 'Quotation source and office identity are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER office_source_identity BEFORE UPDATE ON "CrmQuotation" FOR EACH ROW EXECUTE FUNCTION app.quotation_office_source();

CREATE FUNCTION app.office_snapshot_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE office text; item jsonb; source_office text;
BEGIN
 office:=app.native_record_office(NEW."tenantId",'CrmQuotation',NEW."quotationId");
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.snapshot->'items','[]'::jsonb)) LOOP
  source_office:=app.native_record_office(NEW."tenantId",'CatalogItem',item->>'itemId');
  IF source_office IS NOT NULL AND source_office IS DISTINCT FROM office THEN RAISE EXCEPTION 'Linked records must belong to the same office' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER office_snapshot BEFORE INSERT ON "CrmQuotationRevision" FOR EACH ROW EXECUTE FUNCTION app.office_snapshot_items();
CREATE FUNCTION app.office_unit_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 IF app.native_record_office(NEW."tenantId",'RealEstateProject',NEW."projectId") IS DISTINCT FROM app.native_record_office(OLD."tenantId",'RealEstateProject',OLD."projectId") THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER office_unit_identity BEFORE UPDATE ON "RealEstateUnit" FOR EACH ROW EXECUTE FUNCTION app.office_unit_identity();

-- Every child checks the canonical existing source, including on INSERT where
-- the child row is not visible to a definer lookup yet.
DO $$ DECLARE row record; expr text; BEGIN
 FOR row IN SELECT * FROM (VALUES
 ('CrmQuotation','opportunities','opportunityId'),('CrmQuotationRevision','quotations','quotationId'),
 ('SalesOrder','quotations','quotationId'),('SalesOrderEvent','salesOrders','orderId'),
 ('OrderReceivable','salesOrders','orderId'),('OrderReceivableLine','salesOrders','orderId'),('OrderReceipt','salesOrders','orderId'),('OrderReceiptAllocation','salesOrders','orderId'),('OrderReceiptReversal','salesOrders','orderId'),
 ('CrmActivity','enquiries','enquiryId'),('CrmTaskEvent','activities','taskId'),('CrmOpportunityActivity','opportunities','opportunityId'),
 ('RealEstateProjectMember','projects','projectId'),('RealEstateProjectCategory','projects','projectId'),
 ('RealEstateEnquiryContext','enquiries','enquiryId'),('RealEstateOpportunityContext','opportunities','opportunityId'),('RealEstateUnit','projects','projectId'),('CrmEnquiryImportRow','enquiryImports','importId')
 ) AS sources(tbl,resource,key) LOOP
  expr:=format('app.record_office_allowed("tenantId",%L,%I,nullif(current_setting(''app.actor_id'',true),''''))',row.resource,row.key);
  EXECUTE format('CREATE POLICY office_source ON %I AS RESTRICTIVE FOR ALL USING (%s)',row.tbl,expr);
 END LOOP;
END $$;
-- Typed filters can examine many field values. Resolve their visible parent set
-- as an uncorrelated subquery, retaining the parent's office and sharing RLS.
-- Re-running a company-membership resolver per value makes a selective filter
-- quadratic in authorization work. No definer lookup exposes hidden IDs here.
DO $$ DECLARE source record; BEGIN
 FOR source IN SELECT * FROM (VALUES ('CrmEnquiryFieldValue','CrmEnquiry'),('CrmOpportunityFieldValue','CrmOpportunity'),('RealEstateProjectFieldValue','RealEstateProject')) v(tbl,parent) LOOP
  EXECUTE format('CREATE POLICY office_source ON %I AS RESTRICTIVE FOR ALL USING (current_setting(''app.rls_bypass'',true)=''on'' OR "recordId" IN (SELECT id FROM %I WHERE "tenantId"=nullif(current_setting(''app.tenant_id'',true),'''')))',source.tbl,source.parent);
 END LOOP;
END $$;
CREATE POLICY office_catalog ON "CatalogItem" AS RESTRICTIVE FOR ALL USING (app.record_office_allowed("tenantId",'catalogItems',id,nullif(current_setting('app.actor_id',true),'')));
CREATE POLICY office_availability ON "CatalogReservationAvailability" AS RESTRICTIVE FOR SELECT USING (app.record_office_allowed("tenantId",'catalogItems',"itemId",nullif(current_setting('app.actor_id',true),'')));
CREATE POLICY office_reservation ON "UnitReservation" AS RESTRICTIVE FOR ALL USING (app.record_office_allowed("tenantId",'salesOrders',"orderId",nullif(current_setting('app.actor_id',true),'')) AND app.record_office_allowed("tenantId",'catalogItems',"itemId",nullif(current_setting('app.actor_id',true),'')));
CREATE POLICY office_reservation_event ON "UnitReservationEvent" AS RESTRICTIVE FOR ALL USING (app.record_office_allowed("tenantId",'unitReservations',"reservationId",nullif(current_setting('app.actor_id',true),'')));
CREATE POLICY office_sharing ON "RecordSharingPolicy" AS RESTRICTIVE FOR ALL USING (app.record_office_allowed("tenantId",resource,"recordId",nullif(current_setting('app.actor_id',true),'')));
CREATE POLICY office_sharing_grant ON "RecordSharingGrant" AS RESTRICTIVE FOR ALL USING (EXISTS(SELECT 1 FROM "RecordSharingPolicy" p WHERE p."tenantId"="RecordSharingGrant"."tenantId" AND p.id="RecordSharingGrant"."policyId"));

CREATE FUNCTION app.office_audit_allowed(t text,entity text,k text,b jsonb,a jsonb,u text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE resource text; doc jsonb; pair record; target text;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' THEN RETURN true; END IF;
 IF entity IN ('OrderReceipt','OrderReceiptReversal','OrderReceivableLine') THEN
  IF entity='OrderReceipt' THEN SELECT "orderId" INTO target FROM public."OrderReceipt" WHERE "tenantId"=t AND id=k;
  ELSIF entity='OrderReceiptReversal' THEN SELECT "orderId" INTO target FROM public."OrderReceiptReversal" WHERE "tenantId"=t AND "paymentId"=k;
  ELSE SELECT "orderId" INTO target FROM public."OrderReceivableLine" WHERE "tenantId"=t AND id=k; END IF;
  IF target IS NULL OR NOT app.record_office_allowed(t,'salesOrders',target,u) THEN RETURN false; END IF;
 END IF;
 resource:=CASE entity WHEN 'CrmEnquiry' THEN 'enquiries' WHEN 'CrmOpportunity' THEN 'opportunities' WHEN 'CrmTask' THEN 'activities' WHEN 'RealEstateProject' THEN 'projects' WHEN 'CrmQuotation' THEN 'quotations' WHEN 'SalesOrder' THEN 'salesOrders' WHEN 'OrderReceivable' THEN 'salesOrders' WHEN 'UnitReservation' THEN 'unitReservations' WHEN 'CatalogItem' THEN 'catalogItems' WHEN 'CrmEnquiryImport' THEN 'enquiryImports' WHEN 'CrmPlanLaunch' THEN 'planLaunches' END;
 IF resource IS NOT NULL AND NOT app.record_office_allowed(t,resource,k,u) THEN RETURN false; END IF;
 IF resource IS NULL AND NOT (COALESCE(b,'{}'::jsonb) ?| ARRAY['officeId','enquiryId','opportunityId','projectId','subprojectId','quotationId','orderId','taskId','launchId','importId','itemId','targetKey']) AND NOT (COALESCE(a,'{}'::jsonb) ?| ARRAY['officeId','enquiryId','opportunityId','projectId','subprojectId','quotationId','orderId','taskId','launchId','importId','itemId','targetKey']) THEN RETURN true; END IF;
 FOREACH doc IN ARRAY ARRAY[b,a] LOOP
  IF jsonb_typeof(doc)='object' THEN
   IF jsonb_typeof(doc->'officeId')='string' AND NOT app.business_office_access(t,doc->>'officeId',u) THEN RETURN false; END IF;
   FOR pair IN SELECT * FROM (VALUES ('enquiryId','enquiries'),('opportunityId','opportunities'),('projectId','projects'),('subprojectId','projects'),('quotationId','quotations'),('orderId','salesOrders'),('taskId','activities'),('launchId','planLaunches'),('importId','enquiryImports'),('itemId','catalogItems')) v(key,resource) LOOP
    IF jsonb_typeof(doc->pair.key)='string' AND NOT app.record_office_allowed(t,pair.resource,doc->>pair.key,u) THEN RETURN false; END IF;
   END LOOP;
   target:=doc->>'targetKey';
   IF target LIKE 'enquiry:%' AND NOT app.record_office_allowed(t,'enquiries',substr(target,9),u) THEN RETURN false; END IF;
   IF target LIKE 'opportunity:%' AND NOT app.record_office_allowed(t,'opportunities',substr(target,13),u) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE POLICY office_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING (app.office_audit_allowed("tenantId","entityType","entityId",before,after,nullif(current_setting('app.actor_id',true),'')));

-- Expiry remains a clock-only availability operation, bound to the visible item.
CREATE OR REPLACE FUNCTION app.expire_item_reservations(t text,item text,request text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE u text:=COALESCE(current_setting('app.actor_id',true),''); who public."User"%ROWTYPE; expired record;
BEGIN
 IF NOT app.tenant_match(t) THEN RAISE EXCEPTION 'Tenant context required' USING ERRCODE='42501'; END IF;
 SELECT * INTO who FROM public."User" WHERE "tenantId"=t AND id=u AND status='ACTIVE' AND role IN ('ADMIN','MANAGER','STAFF');
 IF NOT FOUND OR NOT app.record_sharing_allowed(t,'catalogItems',item,u,'READ') OR NOT app.record_office_allowed(t,'catalogItems',item,u) THEN RAISE EXCEPTION 'Catalog access required' USING ERRCODE='42501'; END IF;
 PERFORM id FROM public."CatalogItem" WHERE "tenantId"=t AND id=item FOR UPDATE;
 FOR expired IN UPDATE public."UnitReservation" SET status='EXPIRED',version=version+1,"updatedAt"=clock_timestamp() WHERE "tenantId"=t AND "itemId"=item AND status='HELD' AND "expiresAt"<=clock_timestamp() RETURNING id,version LOOP
  INSERT INTO public."UnitReservationEvent"("tenantId","reservationId",version,status,"actorId","actorName",reason) VALUES(t,expired.id,expired.version,'EXPIRED',u,COALESCE(who.name,who.email,'User'),'Hold expired at its scheduled expiry.');
  INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId",before,after)
   VALUES(gen_random_uuid()::text,t,'catalog.reservation.expired','UnitReservation',expired.id,u,who.role,request,jsonb_build_object('status','HELD'),jsonb_build_object('status','EXPIRED','version',expired.version,'reason','Hold expired at its scheduled expiry.'));
 END LOOP;
END $$;


COMMIT;
