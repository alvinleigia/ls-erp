BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Leave ownership migration requires BYPASSRLS'; END IF; END $$;
-- Normalize only missing tenant identities; reject conflicting source identities.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM "LeaveRequest" r JOIN "StaffProfile" s ON s.id=r."staffProfileId" JOIN "User" u ON u.id=s."userId" JOIN "LeaveDefinition" d ON d.id=r."leaveDefinitionId" WHERE u."tenantId" IS NULL OR d."tenantId" IS DISTINCT FROM u."tenantId" OR (r."tenantId" IS NOT NULL AND r."tenantId" IS DISTINCT FROM u."tenantId")) THEN RAISE EXCEPTION 'Leave request tenant identities disagree'; END IF; END $$;
UPDATE "LeaveRequest" r SET "tenantId"=u."tenantId" FROM "StaffProfile" s JOIN "User" u ON u.id=s."userId" WHERE r."staffProfileId"=s.id AND r."tenantId" IS NULL;
ALTER TABLE "LeaveRequest" ADD COLUMN "officeId" text;
UPDATE "LeaveRequest" r SET "officeId"=o.id FROM "BusinessOffice" o WHERE o."tenantId"=r."tenantId" AND o."isInitial";
ALTER TABLE "LeaveRequest" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "officeId" SET NOT NULL, ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id();
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "LeaveRequest_tenantId_officeId_idx" ON "LeaveRequest"("tenantId","officeId");

CREATE TABLE "StaffRosterLeaveSnapshot" (
 "historyId" text PRIMARY KEY REFERENCES "StaffRosterHistoryDay"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "tenantId" text NOT NULL,"officeId" text NOT NULL,"staffProfileId" text NOT NULL REFERENCES "StaffProfile"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 source "StaffRosterDaySource" NOT NULL,"leaveRequestId" text REFERENCES "LeaveRequest"(id) ON DELETE SET NULL ON UPDATE CASCADE,
 "leaveDefinitionCode" text,"leaveDefinitionName" text,"leaveReason" text,
 CONSTRAINT "StaffRosterLeaveSnapshot_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX "StaffRosterLeaveSnapshot_tenantId_officeId_idx" ON "StaffRosterLeaveSnapshot"("tenantId","officeId");
CREATE INDEX "StaffRosterLeaveSnapshot_staffProfileId_idx" ON "StaffRosterLeaveSnapshot"("staffProfileId");
CREATE INDEX "StaffRosterLeaveSnapshot_leaveRequestId_idx" ON "StaffRosterLeaveSnapshot"("leaveRequestId");
INSERT INTO "StaffRosterLeaveSnapshot" SELECT h.id,u."tenantId",COALESCE(r."officeId",o.id),h."staffProfileId",h.source,h."leaveRequestId",h."leaveDefinitionCode",h."leaveDefinitionName",h."leaveReason"
 FROM "StaffRosterHistoryDay" h JOIN "StaffProfile" s ON s.id=h."staffProfileId" JOIN "User" u ON u.id=s."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" LEFT JOIN "LeaveRequest" r ON r.id=h."leaveRequestId"
 WHERE h.source='LEAVE' OR h."leaveRequestId" IS NOT NULL OR h."leaveDefinitionCode" IS NOT NULL OR h."leaveDefinitionName" IS NOT NULL OR h."leaveReason" IS NOT NULL;
UPDATE "StaffRosterHistoryDay" SET source='UNAVAILABLE' WHERE source='LEAVE';
DROP POLICY tenant_isolation ON "StaffRosterHistoryDay";
ALTER TABLE "StaffRosterHistoryDay" DROP COLUMN "leaveRequestId",DROP COLUMN "leaveDefinitionCode",DROP COLUMN "leaveDefinitionName",DROP COLUMN "leaveReason";
CREATE POLICY tenant_isolation ON "StaffRosterHistoryDay" FOR ALL USING (app.staff_profile_in_tenant("staffProfileId")) WITH CHECK (app.staff_profile_in_tenant("staffProfileId") AND ("templateId" IS NULL OR app.shift_template_in_tenant("templateId")));
ALTER TABLE "StaffRosterHistoryDay" ADD CONSTRAINT "StaffRosterHistoryDay_generic_source" CHECK(source<>'LEAVE');

CREATE OR REPLACE FUNCTION app.native_record_office(t text,kind text,k text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE result text; parent text;
BEGIN
 IF k IS NULL OR k='' THEN RETURN NULL; END IF;
 IF kind IN ('CrmEnquiry','CrmOpportunity','CrmTask','RealEstateProject','CrmEnquiryImport','CrmPlanLaunch','LeaveRequest') THEN
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

CREATE FUNCTION app.leave_capability(t text,u text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS(SELECT 1 FROM public."User" person JOIN public."Tenant" tenant ON tenant.id=person."tenantId" JOIN public."TenantModule" module ON module."tenantId"=tenant.id AND module.key='leaves' AND module.allowed AND module.enabled
 WHERE tenant.id=t AND tenant.status='ACTIVE' AND person.id=u AND person.status='ACTIVE' AND person.role IN ('ADMIN','MANAGER','STAFF') AND (person.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" profile ON profile."tenantId"=a."tenantId" AND profile.id=a."roleId" AND NOT profile.archived JOIN public."TenantUserAccess" policy ON policy."tenantId"=a."tenantId" AND policy."userId"=a."userId"
 WHERE a."tenantId"=t AND a."userId"=u AND p=ANY(profile.permissions) AND CASE WHEN split_part(p,'.',1)='leaveRequests' THEN policy.rules->>p='OWN' ELSE policy.rules->>p IN ('REPORTS','ALL') END
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" reader JOIN public."TenantAccessRole" reader_profile ON reader_profile."tenantId"=reader."tenantId" AND reader_profile.id=reader."roleId" AND NOT reader_profile.archived WHERE reader."tenantId"=t AND reader."userId"=u AND (split_part(p,'.',1)||'.read')=ANY(reader_profile.permissions))
 AND CASE WHEN split_part(p,'.',1)='leaveRequests' THEN policy.rules->>'leaveRequests.read'='OWN' ELSE policy.rules->>'leaveApprovals.read' IN ('REPORTS','ALL') END)))
$$;
REVOKE ALL ON FUNCTION app.leave_capability(text,text,text) FROM PUBLIC;

CREATE FUNCTION app.leave_reader(t text,o text,staff text,u text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."StaffProfile" s JOIN public."User" employee ON employee.id=s."userId" JOIN public."User" caller ON caller.id=u AND caller."tenantId"=t WHERE s.id=staff AND employee."tenantId"=t AND (
 (caller.role='ADMIN' AND app.leave_capability(t,u,'leaveApprovals.read')) OR
 (s."userId"=u AND app.leave_capability(t,u,'leaveRequests.read')) OR
 (s."userId"<>u AND s."managerUserId"=u AND s."leaveApprovalMode"='REPORTING_MANAGER' AND app.leave_capability(t,u,'leaveApprovals.read') AND app.office_membership_exists(t,o,u))))
$$;
REVOKE ALL ON FUNCTION app.leave_reader(text,text,text,text) FROM PUBLIC;
CREATE FUNCTION app.leave_readable(t text,o text,staff text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.leave_reader(t,o,staff,nullif(current_setting('app.actor_id',true),''))
$$;
CREATE POLICY leave_record ON "LeaveRequest" AS RESTRICTIVE FOR ALL USING (current_setting('app.rls_bypass',true)='on' OR app.leave_readable("tenantId","officeId","staffProfileId"));
CREATE POLICY leave_no_delete ON "LeaveRequest" AS RESTRICTIVE FOR DELETE USING (current_setting('app.rls_bypass',true)='on');
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "StaffRosterLeaveSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffRosterLeaveSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY private_snapshot ON "StaffRosterLeaveSnapshot" FOR SELECT USING (current_setting('app.rls_bypass',true)='on' OR app.leave_readable("tenantId","officeId","staffProfileId"));
GRANT SELECT ON "StaffRosterLeaveSnapshot" TO PUBLIC;

CREATE FUNCTION app.leave_office_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE u text:=nullif(current_setting('app.actor_id',true),''); staff public."StaffProfile"%ROWTYPE; expected text; permission text;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN NEW; END IF;
 SELECT s.* INTO staff FROM public."StaffProfile" s JOIN public."User" person ON person.id=s."userId" WHERE s.id=NEW."staffProfileId" AND person."tenantId"=NEW."tenantId";
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."LeaveDefinition" d WHERE d.id=NEW."leaveDefinitionId" AND d."tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Leave ownership access is not permitted' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  expected:=nullif(current_setting('app.office_version',true),'');
  IF NEW."officeId" IS NULL OR NEW."officeId" IS DISTINCT FROM app.creation_office_id() OR expected IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=NEW."tenantId" AND p."userId"=u AND p."creationOfficeId"=NEW."officeId" AND p.version::text=expected) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001'; END IF;
  IF staff."userId" IS DISTINCT FROM u OR NEW.status<>'PENDING' OR NOT app.leave_capability(NEW."tenantId",u,'leaveRequests.create') OR NOT app.business_office_allowed(NEW."tenantId",NEW."officeId",u) THEN RAISE EXCEPTION 'Office creation access is not permitted' USING ERRCODE='42501'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','reviewedByUserId','reviewedAt','reviewerComment','canceledAt','cancelReason','revokedAt','revokedByUserId','revokeReason','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewedByUserId','reviewedAt','reviewerComment','canceledAt','cancelReason','revokedAt','revokedByUserId','revokeReason','updatedAt']) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
  IF staff."userId"=u THEN
   IF NEW.status<>'CANCELED' OR OLD.status NOT IN ('PENDING','APPROVED') OR NOT app.leave_capability(NEW."tenantId",u,'leaveRequests.archive') OR (to_jsonb(NEW)-ARRAY['status','canceledAt','cancelReason','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','canceledAt','cancelReason','updatedAt']) THEN RAISE EXCEPTION 'Leave ownership access is not permitted' USING ERRCODE='42501'; END IF;
  ELSE
   permission:=CASE WHEN NEW.status IN ('APPROVED','REJECTED') THEN 'leaveApprovals.approve' ELSE 'leaveApprovals.archive' END;
   IF NOT ((NEW.status IN ('APPROVED','REJECTED') AND OLD.status='PENDING') OR (NEW.status='REVOKED' AND OLD.status='APPROVED') OR (NEW.status='CANCELED' AND OLD.status IN ('PENDING','APPROVED'))) THEN RAISE EXCEPTION 'Leave ownership access is not permitted' USING ERRCODE='42501'; END IF;
   IF NOT app.leave_reader(NEW."tenantId",NEW."officeId",NEW."staffProfileId",u) OR NOT app.leave_capability(NEW."tenantId",u,permission) OR NOT app.business_office_allowed(NEW."tenantId",NEW."officeId",u) THEN RAISE EXCEPTION 'Record office access is not permitted' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.leave_office_owner() FROM PUBLIC;
CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION app.leave_office_owner();

-- Canonical snapshot hydration runs inside the history writer's transaction.
-- It cannot return private source values to the scheduling caller.
CREATE FUNCTION app.roster_private_leave() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE request public."LeaveRequest"%ROWTYPE; t text;
BEGIN
 SELECT person."tenantId" INTO t FROM public."StaffProfile" staff JOIN public."User" person ON person.id=staff."userId" WHERE staff.id=NEW."staffProfileId";
 IF t IS NULL OR (current_setting('app.rls_bypass',true) IS DISTINCT FROM 'on' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) AND t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')) THEN RAISE EXCEPTION 'Tenant context required' USING ERRCODE='42501'; END IF;
 IF current_setting('app.rls_bypass',true) IS DISTINCT FROM 'on' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN
  IF NOT EXISTS(SELECT 1 FROM public."StaffProfile" s WHERE s.id=NEW."staffProfileId" AND s."userId"=nullif(current_setting('app.actor_id',true),'') AND app.leave_capability(t,s."userId",'leaveRequests.read')) THEN
   BEGIN PERFORM app.require_booking_integrity_access(t); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'Roster history access is not permitted' USING ERRCODE='42501'; END;
  END IF;
 END IF;
 IF TG_WHEN='BEFORE' AND TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."staffProfileId" IS DISTINCT FROM OLD."staffProfileId" OR NEW.date IS DISTINCT FROM OLD.date) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
 SELECT r.* INTO request FROM public."LeaveRequest" r WHERE r."tenantId"=t AND r."staffProfileId"=NEW."staffProfileId" AND r.status='APPROVED' AND r."startDate"<=NEW.date AND r."endDate">=NEW.date ORDER BY r."startDate",r."createdAt",r.id LIMIT 1;
 IF TG_WHEN='BEFORE' THEN
  IF request.id IS NOT NULL THEN NEW.source:='UNAVAILABLE';NEW."templateId":=NULL;NEW."templateName":=NULL;NEW."startTime":=NULL;NEW."endTime":=NULL;NEW."paidMinutes":=0;
  ELSIF NEW.source='LEAVE' THEN NEW.source:='UNAVAILABLE'; END IF;
 ELSE
  IF request.id IS NULL THEN DELETE FROM public."StaffRosterLeaveSnapshot" WHERE "historyId"=NEW.id;
  ELSE INSERT INTO public."StaffRosterLeaveSnapshot"("historyId","tenantId","officeId","staffProfileId",source,"leaveRequestId","leaveDefinitionCode","leaveDefinitionName","leaveReason") SELECT NEW.id,t,request."officeId",NEW."staffProfileId",'LEAVE',request.id,d.code,d.name,request.reason FROM public."LeaveDefinition" d WHERE d.id=request."leaveDefinitionId"
   ON CONFLICT("historyId") DO UPDATE SET "tenantId"=excluded."tenantId","officeId"=excluded."officeId","staffProfileId"=excluded."staffProfileId",source=excluded.source,"leaveRequestId"=excluded."leaveRequestId","leaveDefinitionCode"=excluded."leaveDefinitionCode","leaveDefinitionName"=excluded."leaveDefinitionName","leaveReason"=excluded."leaveReason";
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.roster_private_leave() FROM PUBLIC;
CREATE TRIGGER private_leave_before BEFORE INSERT OR UPDATE ON "StaffRosterHistoryDay" FOR EACH ROW EXECUTE FUNCTION app.roster_private_leave();
CREATE TRIGGER private_leave_after AFTER INSERT OR UPDATE ON "StaffRosterHistoryDay" FOR EACH ROW EXECUTE FUNCTION app.roster_private_leave();

CREATE FUNCTION app.leave_audit_readable(t text,k text,details jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE ids text[]; target text; request public."LeaveRequest"%ROWTYPE;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' THEN RETURN true; END IF;
 IF k IS NOT NULL THEN ids:=ARRAY[k]; ELSIF jsonb_typeof(details->'requestIds')='array' THEN SELECT array_agg(value) INTO ids FROM jsonb_array_elements_text(details->'requestIds'); END IF;
 IF cardinality(ids) IS NULL OR cardinality(ids)=0 THEN RETURN false; END IF;
 FOREACH target IN ARRAY ids LOOP
  SELECT * INTO request FROM public."LeaveRequest" WHERE "tenantId"=t AND id=target;
  IF NOT FOUND OR NOT app.leave_readable(t,request."officeId",request."staffProfileId") THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE POLICY leave_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING ("entityType" IS DISTINCT FROM 'LeaveRequest' OR app.leave_audit_readable("tenantId","entityId",metadata));

CREATE FUNCTION app.leave_notice_recipient(t text,k text,target text,action text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."LeaveRequest" r WHERE r."tenantId"=t AND r.id=k AND app.leave_readable(t,r."officeId",r."staffProfileId") AND app.leave_reader(t,r."officeId",r."staffProfileId",target)
 AND (action='read' OR (action='approve' AND app.leave_capability(t,target,'leaveApprovals.approve') AND EXISTS(SELECT 1 FROM public."BusinessOffice" o JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" WHERE o."tenantId"=t AND o.id=r."officeId" AND NOT o.archived AND NOT c.archived))))
$$;
COMMIT;
