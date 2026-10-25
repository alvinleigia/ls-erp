BEGIN;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Availability projection requires the migration owner with BYPASSRLS'; END IF;
END $$;

-- Integrity projection, not a leave directory. Authorized schedulers can learn
-- only unavailable dates for specified staff, even when source rows are hidden.
-- Identity is taken from transaction-local context, never a target-user argument.
CREATE FUNCTION app.approved_leave_blocks(t text,profiles text[],first_day date,last_day date)
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
  JOIN public."TenantAccessRole" profile ON profile."tenantId"=t AND profile.id=assignment."roleId" AND NOT profile.archived AND capability.permission=ANY(profile.permissions)
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
REVOKE ALL ON FUNCTION app.approved_leave_blocks(text,text[],date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.approved_leave_blocks(text,text[],date,date) TO PUBLIC;

COMMIT;
