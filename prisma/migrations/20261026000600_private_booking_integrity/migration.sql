BEGIN;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Booking integrity projections require the migration owner with BYPASSRLS'; END IF;
END $$;

-- The projections are integrity checks, not record directories. Every invocation
-- refreshes identity and source capability; labels alone grant no authority.
CREATE FUNCTION app.require_booking_integrity_access(t text, appointments_only boolean DEFAULT false)
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
  JOIN public."TenantAccessRole" profile ON profile."tenantId"=t AND profile.id=assignment."roleId" AND NOT profile.archived AND capability.permission=ANY(profile.permissions)
  JOIN public."TenantUserAccess" policy ON policy."tenantId"=t AND policy."userId"=caller.id
  WHERE (NOT appointments_only OR capability.permission='appointments.read')
   AND CASE WHEN capability.permission='leaveApprovals.read' THEN policy.rules->>capability.permission IN ('REPORTS','ALL') ELSE policy.rules->>capability.permission='ALL' END
 ) THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION app.appointment_conflict_summary(t text,slots jsonb,excluded_ids text[])
RETURNS TABLE("slotIndex" integer,"staffConflict" boolean,"customerConflict" boolean,"conflictCount" integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE slot jsonb; employee text; customer text; first_time timestamp; last_time timestamp; position integer:=0;
BEGIN
 PERFORM app.require_booking_integrity_access(t);
 IF slots IS NULL OR jsonb_typeof(slots)<>'array' OR jsonb_array_length(slots)>200 OR excluded_ids IS NULL OR cardinality(excluded_ids)>200 OR array_position(excluded_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid booking conflict selection' USING ERRCODE='22023'; END IF;
 -- Customer collision probes and exclusions belong only to appointment readers.
 IF cardinality(excluded_ids)>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(slots) s WHERE nullif(s->>'customerId','') IS NOT NULL) THEN PERFORM app.require_booking_integrity_access(t,true); END IF;
 IF EXISTS(SELECT 1 FROM unnest(excluded_ids) excluded(id) WHERE NOT EXISTS(SELECT 1 FROM public."Appointment" a WHERE a.id=excluded.id AND a."tenantId"=t)) THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(slots) LOOP
  employee:=slot->>'staffProfileId'; customer:=nullif(slot->>'customerId','');
  first_time:=(slot->>'startAt')::timestamptz AT TIME ZONE 'UTC'; last_time:=(slot->>'endAt')::timestamptz AT TIME ZONE 'UTC';
  IF first_time IS NULL OR last_time IS NULL OR NOT isfinite(first_time) OR NOT isfinite(last_time) OR last_time<=first_time THEN RAISE EXCEPTION 'Invalid booking conflict selection' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."StaffProfile" staff JOIN public."User" u ON u.id=staff."userId" WHERE staff.id=employee AND u."tenantId"=t)
   OR (customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."User" u WHERE u.id=customer AND u."tenantId"=t AND u.role='CUSTOMER')) THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT position,coalesce(bool_or(a."staffProfileId"=employee),false),coalesce(bool_or(a."customerId"=customer),false),count(*) FILTER(WHERE a."staffProfileId"=employee)::integer
   FROM public."Appointment" a WHERE a."tenantId"=t AND a.status IN ('SCHEDULED','CONFIRMED','IN_PROGRESS') AND a."startAt"<last_time AND a."endAt">first_time AND NOT(a.id=ANY(excluded_ids)) AND (a."staffProfileId"=employee OR a."customerId"=customer);
  position:=position+1;
 END LOOP;
END $$;

CREATE FUNCTION app.active_staff_booking_slots(t text,profiles text[],active_after timestamp,after_slot jsonb,first_time timestamp,last_time timestamp)
RETURNS TABLE("staffProfileId" text,"startAt" timestamp,"endAt" timestamp)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE total integer; cursor_start timestamp; cursor_end timestamp; cursor_profile text;
BEGIN
 PERFORM app.require_booking_integrity_access(t);
 IF profiles IS NULL OR cardinality(profiles)>200 OR array_position(profiles,NULL) IS NOT NULL OR active_after IS NULL OR NOT isfinite(active_after)
  OR (first_time IS NULL)<>(last_time IS NULL) OR (first_time IS NOT NULL AND (NOT isfinite(first_time) OR NOT isfinite(last_time) OR last_time<=first_time)) THEN RAISE EXCEPTION 'Invalid booking conflict selection' USING ERRCODE='22023'; END IF;
 SELECT count(DISTINCT id) INTO total FROM unnest(profiles) id;
 IF total<>(SELECT count(*) FROM public."StaffProfile" staff JOIN public."User" u ON u.id=staff."userId" WHERE u."tenantId"=t AND staff.id=ANY(profiles)) THEN RAISE EXCEPTION 'Scheduling conflict access is not permitted' USING ERRCODE='42501'; END IF;
 IF after_slot IS NOT NULL AND after_slot<>'null'::jsonb THEN
  cursor_start:=(after_slot->>'startAt')::timestamptz AT TIME ZONE 'UTC'; cursor_end:=(after_slot->>'endAt')::timestamptz AT TIME ZONE 'UTC'; cursor_profile:=after_slot->>'staffProfileId';
  IF cursor_start IS NULL OR cursor_end IS NULL OR NOT isfinite(cursor_start) OR NOT isfinite(cursor_end) OR cursor_profile IS NULL OR NOT(cursor_profile=ANY(profiles)) THEN RAISE EXCEPTION 'Invalid booking conflict cursor' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN QUERY SELECT DISTINCT a."staffProfileId",a."startAt",a."endAt" FROM public."Appointment" a
 WHERE a."tenantId"=t AND a."staffProfileId"=ANY(profiles) AND (a.status='IN_PROGRESS' OR (a.status IN ('SCHEDULED','CONFIRMED') AND a."endAt">active_after))
  AND (first_time IS NULL OR (a."startAt">=first_time AND a."startAt"<last_time))
  AND (cursor_start IS NULL OR (a."startAt",a."endAt",a."staffProfileId")>(cursor_start,cursor_end,cursor_profile))
 ORDER BY a."startAt",a."endAt",a."staffProfileId" LIMIT 200;
END $$;

REVOKE ALL ON FUNCTION app.require_booking_integrity_access(text,boolean),app.appointment_conflict_summary(text,jsonb,text[]),app.active_staff_booking_slots(text,text[],timestamp,jsonb,timestamp,timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.require_booking_integrity_access(text,boolean),app.appointment_conflict_summary(text,jsonb,text[]),app.active_staff_booking_slots(text,text[],timestamp,jsonb,timestamp,timestamp) TO PUBLIC;

COMMIT;
