BEGIN;
ALTER TABLE "User" ADD COLUMN "collaboratorId" text;
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_collaboratorId_fkey" FOREIGN KEY ("tenantId","collaboratorId") REFERENCES "ExternalCollaborator"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_external_identity_check" CHECK ("collaboratorId" IS NULL OR ("tenantId" IS NOT NULL AND role='STAFF'));
CREATE INDEX "User_tenantId_collaboratorId_idx" ON "User"("tenantId","collaboratorId");
-- All existing identities remain internal. Linking is explicit at INSERT only.
CREATE FUNCTION app.guard_external_login_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."collaboratorId" IS DISTINCT FROM OLD."collaboratorId" THEN
  RAISE EXCEPTION 'Login identity is immutable; create a separate external account' USING ERRCODE='23514';
 END IF;
 IF NEW."collaboratorId" IS NOT NULL THEN
  PERFORM 1 FROM public."Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
  IF NEW.role<>'STAFF' THEN RAISE EXCEPTION 'External logins cannot become internal or customer accounts' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."ExternalCollaborator" c WHERE c.id=NEW."collaboratorId" AND c."tenantId"=NEW."tenantId" AND (NOT c.archived OR (TG_OP='UPDATE' AND NEW.status IN ('SUSPENDED','ARCHIVED')))) THEN
   RAISE EXCEPTION 'Choose an active collaborator in this workspace' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_external_login_identity() FROM PUBLIC;
CREATE TRIGGER external_login_identity_guard BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION app.guard_external_login_identity();

-- Archiving atomically blocks all active/invited linked accounts and records the
-- actual status transitions. Restore deliberately does not reactivate accounts.
CREATE FUNCTION app.archive_collaborator_logins() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.archived AND NOT OLD.archived THEN
  WITH prior AS (SELECT id,role,status FROM public."User" WHERE "tenantId"=NEW."tenantId" AND "collaboratorId"=NEW.id AND status IN ('ACTIVE','INVITED') FOR UPDATE),
  changed AS (UPDATE public."User" u SET status='SUSPENDED',"updatedAt"=CURRENT_TIMESTAMP FROM prior p WHERE u.id=p.id RETURNING u.id,p.role,p.status AS "oldStatus")
  INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole",before,after,metadata,"createdAt")
   SELECT 'collaborator_suspend_'||gen_random_uuid()::text,NEW."tenantId",'collaborator.login.suspended','User',c.id,
    nullif(current_setting('app.actor_id',true),''),(SELECT role FROM public."User" WHERE id=nullif(current_setting('app.actor_id',true),'')),
    jsonb_build_object('status',c."oldStatus"),jsonb_build_object('status','SUSPENDED'),jsonb_build_object('collaboratorId',NEW.id,'reason','collaborator_archived'),CURRENT_TIMESTAMP FROM changed c;
  WITH prior AS (SELECT id,"expiresAt" FROM public."Invitation" WHERE "tenantId"=NEW."tenantId" AND "accessConfiguration"->>'collaboratorId'=NEW.id AND "acceptedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP FOR UPDATE),
  changed AS (UPDATE public."Invitation" i SET "expiresAt"=CURRENT_TIMESTAMP FROM prior p WHERE i.id=p.id RETURNING i.id,p."expiresAt" AS "oldExpiry")
  INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole",before,after,metadata,"createdAt")
   SELECT 'collaborator_expire_'||gen_random_uuid()::text,NEW."tenantId",'collaborator.invitation.expired','Invitation',c.id,
    nullif(current_setting('app.actor_id',true),''),(SELECT role FROM public."User" WHERE id=nullif(current_setting('app.actor_id',true),'')),
    jsonb_build_object('expiresAt',c."oldExpiry"),jsonb_build_object('expired',true),jsonb_build_object('collaboratorId',NEW.id,'reason','collaborator_archived'),CURRENT_TIMESTAMP FROM changed c;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.archive_collaborator_logins() FROM PUBLIC;
CREATE TRIGGER collaborator_archive_logins AFTER UPDATE OF archived ON "ExternalCollaborator" FOR EACH ROW EXECUTE FUNCTION app.archive_collaborator_logins();

CREATE FUNCTION app.guard_external_employee_relations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
 IF TG_TABLE_NAME='StaffProfile' THEN
  IF EXISTS(SELECT 1 FROM public."User" WHERE id=NEW."userId" AND "collaboratorId" IS NOT NULL) OR EXISTS(SELECT 1 FROM public."User" WHERE id=NEW."managerUserId" AND "collaboratorId" IS NOT NULL) THEN
   RAISE EXCEPTION 'External logins cannot have employee profiles or employee reporting relationships' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='StaffServiceEligibility' THEN
  IF EXISTS(SELECT 1 FROM public."User" WHERE id=NEW."userId" AND "collaboratorId" IS NOT NULL) THEN RAISE EXCEPTION 'External logins cannot have employee service eligibility' USING ERRCODE='23514'; END IF;
 ELSIF NEW."isManager" AND EXISTS(SELECT 1 FROM public."User" WHERE id=NEW."userId" AND "collaboratorId" IS NOT NULL) THEN
  RAISE EXCEPTION 'External logins cannot manage internal teams' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_external_employee_relations() FROM PUBLIC;
CREATE TRIGGER external_staff_profile_guard BEFORE INSERT OR UPDATE ON "StaffProfile" FOR EACH ROW EXECUTE FUNCTION app.guard_external_employee_relations();
CREATE TRIGGER external_service_eligibility_guard BEFORE INSERT OR UPDATE ON "StaffServiceEligibility" FOR EACH ROW EXECUTE FUNCTION app.guard_external_employee_relations();
CREATE TRIGGER external_team_manager_guard BEFORE INSERT OR UPDATE ON "BusinessTeamMember" FOR EACH ROW EXECUTE FUNCTION app.guard_external_employee_relations();

CREATE FUNCTION app.external_business_actor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."User" WHERE id=nullif(current_setting('app.actor_id',true),'') AND "tenantId"=nullif(current_setting('app.tenant_id',true),'') AND "collaboratorId" IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION app.external_business_actor() FROM PUBLIC;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['StaffProfile','StaffDocument','StaffCertification','StaffServiceEligibility','LeaveRequest','LeaveDefinition','LeaveDefinitionNonClubbable','LeaveGroup','LeaveGroupLeave','LeaveGroupStaffAssignment','ShiftTemplate','ShiftTemplateBreak','ShiftSchedule','ShiftScheduleBlock','StaffScheduleAssignment','StaffFlexibleWeekPlan','StaffFlexibleWeekDay','StaffFlexibleWeekSlot','StaffFlexibleWeekBreak','StaffFlexiblePattern','StaffFlexiblePatternWeek','StaffFlexiblePatternDay','StaffFlexiblePatternSlot','StaffFlexiblePatternBreak','StaffFlexibleAvailability','StaffShiftOverride','StaffRosterHistoryDay','StaffRosterLeaveSnapshot','StaffWorkplacePolicy','StaffWorkplaceAssignment'] LOOP
  EXECUTE format('CREATE POLICY external_employee_boundary ON %I AS RESTRICTIVE FOR ALL USING (current_setting(''app.rls_bypass'',true)=''on'' OR NOT app.external_business_actor())',tbl);
 END LOOP;
END $$;
DO $$ DECLARE tbl text; command text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['BusinessTeam','BusinessTeamMember'] LOOP
  FOREACH command IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
   IF command='INSERT' THEN
    EXECUTE format('CREATE POLICY external_team_insert ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (current_setting(''app.rls_bypass'',true)=''on'' OR NOT app.external_business_actor())',tbl);
   ELSE
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR %s USING (current_setting(''app.rls_bypass'',true)=''on'' OR NOT app.external_business_actor())','external_team_'||lower(command),tbl,command);
   END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE POLICY external_workforce_audit ON "AuditLog" AS RESTRICTIVE FOR ALL USING (current_setting('app.rls_bypass',true)='on' OR NOT app.external_business_actor() OR (event NOT LIKE 'workforce.%' AND event NOT LIKE 'leave.%' AND "entityType" NOT IN ('StaffProfile','StaffDocument','StaffCertification','StaffWorkplaceAssignment')));

CREATE OR REPLACE FUNCTION app.workforce_capability(t text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND p=ANY(ARRAY['shiftSchedules.read','shiftSchedules.create','shiftSchedules.edit','shiftSchedules.archive','shiftTemplates.read','shiftTemplates.create','shiftTemplates.edit','shiftTemplates.archive','shiftPlans.read','shiftPlans.create','shiftPlans.edit','shiftPlans.archive','shiftRoster.read','shiftRoster.edit','shiftRoster.archive']) AND EXISTS(
 SELECT 1 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" JOIN public."TenantModule" m ON m."tenantId"=tenant.id AND m.key='shifts' AND m.allowed AND m.enabled WHERE tenant.id=t AND tenant.status='ACTIVE' AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND u."collaboratorId" IS NULL AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id AND policy.rules->>p='ALL' AND policy.rules->>(split_part(p,'.',1)||'.read')='ALL'
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions)))))
$$;

CREATE OR REPLACE FUNCTION app.workplace_capability(t text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND p IN ('shiftRoster.read','shiftRoster.edit','shiftRoster.archive') AND EXISTS(
 SELECT 1 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" JOIN public."TenantModule" m ON m."tenantId"=tenant.id AND m.key='shifts' AND m.allowed AND m.enabled
 WHERE tenant.id=t AND tenant.status='ACTIVE' AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND u."collaboratorId" IS NULL AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id AND policy.rules->>p='ALL' AND policy.rules->>'shiftRoster.read'='ALL'
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND 'shiftRoster.read'=ANY(r.permissions)))))
$$;

CREATE OR REPLACE FUNCTION app.leave_capability(t text,u text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND EXISTS(SELECT 1 FROM public."User" person JOIN public."Tenant" tenant ON tenant.id=person."tenantId" JOIN public."TenantModule" module ON module."tenantId"=tenant.id AND module.key='leaves' AND module.allowed AND module.enabled
 WHERE tenant.id=t AND tenant.status='ACTIVE' AND person.id=u AND person.status='ACTIVE' AND person."collaboratorId" IS NULL AND person.role IN ('ADMIN','MANAGER','STAFF') AND (person.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" profile ON profile."tenantId"=a."tenantId" AND profile.id=a."roleId" AND NOT profile.archived JOIN public."TenantUserAccess" policy ON policy."tenantId"=a."tenantId" AND policy."userId"=a."userId"
 WHERE a."tenantId"=t AND a."userId"=u AND p=ANY(profile.permissions) AND CASE WHEN split_part(p,'.',1)='leaveRequests' THEN policy.rules->>p='OWN' ELSE policy.rules->>p IN ('REPORTS','ALL') END
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" reader JOIN public."TenantAccessRole" reader_profile ON reader_profile."tenantId"=reader."tenantId" AND reader_profile.id=reader."roleId" AND NOT reader_profile.archived WHERE reader."tenantId"=t AND reader."userId"=u AND (split_part(p,'.',1)||'.read')=ANY(reader_profile.permissions))
 AND CASE WHEN split_part(p,'.',1)='leaveRequests' THEN policy.rules->>'leaveRequests.read'='OWN' ELSE policy.rules->>'leaveApprovals.read' IN ('REPORTS','ALL') END)))
$$;


CREATE OR REPLACE FUNCTION app.approved_leave_blocks(t text,profiles text[],first_day date,last_day date)
RETURNS TABLE("staffProfileId" text,"startDate" date,"endDate" date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE caller public."User"%ROWTYPE; total integer;
BEGIN
 IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') THEN RAISE EXCEPTION 'Scheduling availability access is not permitted' USING ERRCODE='42501'; END IF;
 SELECT u.* INTO caller FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"=t AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF');
 IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling availability access is not permitted' USING ERRCODE='42501'; END IF;
 IF caller.role<>'ADMIN' AND NOT EXISTS(
  SELECT 1 FROM (VALUES ('appointments.read','appointments'),('shiftTemplates.read','shifts'),('shiftSchedules.read','shifts'),('shiftPlans.read','shifts'),('shiftRoster.read','shifts')) capability(permission,module)
  JOIN public."TenantModule" module ON module."tenantId"=t AND module.key=capability.module AND module.allowed AND module.enabled
  JOIN public."TenantRoleAssignment" assignment ON assignment."tenantId"=t AND assignment."userId"=caller.id
  JOIN public."TenantAccessRole" profile ON profile."tenantId"=t AND profile.id=assignment."roleId" AND NOT profile.archived AND capability.permission=ANY(profile.permissions) AND (caller."collaboratorId" IS NULL OR capability.permission='appointments.read')
  JOIN public."TenantUserAccess" policy ON policy."tenantId"=t AND policy."userId"=caller.id AND policy.rules->>capability.permission='ALL'
 ) THEN RAISE EXCEPTION 'Scheduling availability access is not permitted' USING ERRCODE='42501'; END IF;
 IF profiles IS NULL OR cardinality(profiles)>200 OR array_position(profiles,NULL) IS NOT NULL OR first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR last_day<first_day THEN
  RAISE EXCEPTION 'Invalid availability range or staff selection' USING ERRCODE='22023';
 END IF;
 SELECT count(DISTINCT id) INTO total FROM unnest(profiles) id;
 IF total<>(SELECT count(*) FROM public."StaffProfile" staff JOIN public."User" employee ON employee.id=staff."userId" WHERE employee."tenantId"=t AND staff.id=ANY(profiles)) THEN
  RAISE EXCEPTION 'Scheduling availability access is not permitted' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT DISTINCT request."staffProfileId",greatest(request."startDate",first_day),least(request."endDate",last_day)
 FROM public."LeaveRequest" request JOIN public."StaffProfile" staff ON staff.id=request."staffProfileId"
 JOIN public."User" employee ON employee.id=staff."userId" AND employee."tenantId"=t
 WHERE request."tenantId"=t AND request."staffProfileId"=ANY(profiles) AND request.status='APPROVED' AND request."startDate"<=last_day AND request."endDate">=first_day
 ORDER BY 1,2,3;
END $$;

CREATE OR REPLACE FUNCTION app.require_booking_integrity_access(t text, appointments_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE caller public."User"%ROWTYPE;
BEGIN
 IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
 SELECT u.* INTO caller FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"=t AND u.status='ACTIVE' AND tenant.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF');
 IF NOT FOUND THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
 IF caller.role<>'ADMIN' AND NOT EXISTS(
  SELECT 1 FROM (VALUES ('appointments.read','appointments'),('shiftTemplates.read','shifts'),('shiftSchedules.read','shifts'),('shiftPlans.read','shifts'),('shiftRoster.read','shifts'),('leaveApprovals.read','leaves')) capability(permission,module)
  JOIN public."TenantModule" module ON module."tenantId"=t AND module.key=capability.module AND module.allowed AND module.enabled
  JOIN public."TenantRoleAssignment" assignment ON assignment."tenantId"=t AND assignment."userId"=caller.id
  JOIN public."TenantAccessRole" profile ON profile."tenantId"=t AND profile.id=assignment."roleId" AND NOT profile.archived AND capability.permission=ANY(profile.permissions) AND (caller."collaboratorId" IS NULL OR capability.permission='appointments.read')
  JOIN public."TenantUserAccess" policy ON policy."tenantId"=t AND policy."userId"=caller.id
  WHERE (NOT appointments_only OR capability.permission='appointments.read')
   AND CASE WHEN capability.permission='leaveApprovals.read' THEN policy.rules->>capability.permission IN ('REPORTS','ALL') ELSE policy.rules->>capability.permission='ALL' END
 ) THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION app.require_working_time_access(t text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 PERFORM app.require_booking_integrity_access(t);
 IF NOT EXISTS(
  SELECT 1 FROM (VALUES ('appointments.read','appointments'),('shiftTemplates.read','shifts'),('shiftSchedules.read','shifts'),('shiftPlans.read','shifts'),('shiftRoster.read','shifts'),('leaveApprovals.read','leaves')) capability(permission,module)
  JOIN public."TenantModule" m ON m."tenantId"=t AND m.key=capability.module AND m.allowed AND m.enabled
  JOIN public."User" u ON u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND (u."collaboratorId" IS NULL OR capability.permission='appointments.read')
  WHERE u.role='ADMIN' OR EXISTS(
   SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id
   AND CASE WHEN capability.permission='leaveApprovals.read' THEN policy.rules->>capability.permission IN ('REPORTS','ALL') ELSE policy.rules->>capability.permission='ALL' END
   AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND capability.permission=ANY(r.permissions))
  )
 ) THEN RAISE EXCEPTION 'Working-time access is not permitted' USING ERRCODE='42501'; END IF;
END $$;

COMMIT;
