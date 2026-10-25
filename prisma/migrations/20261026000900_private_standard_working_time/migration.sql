BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Working-time projection requires the migration owner with BYPASSRLS'; END IF;
END $$;

-- Integrity consumers may use working hours without acquiring source Read. Source
-- module deactivation does not erase hours when another active consumer needs them.
CREATE FUNCTION app.require_working_time_access(t text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 PERFORM app.require_booking_integrity_access(t);
 IF NOT EXISTS(
  SELECT 1 FROM (VALUES ('appointments.read','appointments'),('shiftTemplates.read','shifts'),('shiftSchedules.read','shifts'),('shiftPlans.read','shifts'),('shiftRoster.read','shifts'),('leaveApprovals.read','leaves')) capability(permission,module)
  JOIN public."TenantModule" m ON m."tenantId"=t AND m.key=capability.module AND m.allowed AND m.enabled
  JOIN public."User" u ON u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE'
  WHERE u.role='ADMIN' OR EXISTS(
   SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id
   AND CASE WHEN capability.permission='leaveApprovals.read' THEN policy.rules->>capability.permission IN ('REPORTS','ALL') ELSE policy.rules->>capability.permission='ALL' END
   AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND capability.permission=ANY(r.permissions))
  )
 ) THEN RAISE EXCEPTION 'Working-time access is not permitted' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION app.require_working_time_access(text) FROM PUBLIC;

-- One bounded batch of requested staff/days. Schedule, assignment, block, template
-- and break identifiers and labels never leave this function. Ordinary source RLS
-- must not change the selected assignment or substitute a visible default.
CREATE FUNCTION app.standard_working_time(t text,profiles text[],first_day date,last_day date)
RETURNS TABLE("staffProfileId" text,date date,"startTime" text,"endTime" text,breaks jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 PERFORM app.require_working_time_access(t);
 IF profiles IS NULL OR cardinality(profiles)>200 OR array_position(profiles,NULL) IS NOT NULL
 OR first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>365
 THEN RAISE EXCEPTION 'Invalid working-time selection' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(profiles) p(id) WHERE NOT EXISTS(SELECT 1 FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE s.id=p.id AND u."tenantId"=t)) THEN RAISE EXCEPTION 'Working-time access is not permitted' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 WITH staff AS MATERIALIZED (
  SELECT s.id FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE u."tenantId"=t AND s.id=ANY(profiles) AND s."schedulingMode"='STANDARD'
 ), assignments AS MATERIALIZED (
  SELECT a.id,a."staffProfileId",a."scheduleId",a."startDate",a."endDate" FROM public."StaffScheduleAssignment" a JOIN staff ON staff.id=a."staffProfileId" JOIN public."ShiftSchedule" s ON s.id=a."scheduleId" AND s."tenantId"=t
  WHERE a."startDate"<=last_day AND (a."endDate" IS NULL OR a."endDate">=first_day)
 ), default_schedule AS MATERIALIZED (
  SELECT s.id FROM public."ShiftSchedule" s WHERE s."tenantId"=t AND s."isDefault" ORDER BY s."updatedAt" DESC,s.id DESC LIMIT 1
 ), schedules AS MATERIALIZED (
  SELECT s.* FROM public."ShiftSchedule" s WHERE s."tenantId"=t AND (s.id IN (SELECT a."scheduleId" FROM assignments a) OR s.id IN (SELECT d.id FROM default_schedule d))
 ), blocks AS MATERIALIZED (
  SELECT b."scheduleId",b."templateId",b."repeatDays",sum(b."repeatDays") OVER(PARTITION BY b."scheduleId" ORDER BY b."sortOrder",b.id ROWS UNBOUNDED PRECEDING) AS through,
   sum(b."repeatDays") OVER(PARTITION BY b."scheduleId") AS cycle
  FROM public."ShiftScheduleBlock" b JOIN schedules s ON s.id=b."scheduleId" WHERE b."repeatDays">0
 ), calendar AS MATERIALIZED (
  SELECT s.id,d.day::date AS day,
   NOT (extract(dow FROM d.day)::integer=CASE s."weekOffDay1" WHEN 'SUNDAY' THEN 0 WHEN 'MONDAY' THEN 1 WHEN 'TUESDAY' THEN 2 WHEN 'WEDNESDAY' THEN 3 WHEN 'THURSDAY' THEN 4 WHEN 'FRIDAY' THEN 5 ELSE 6 END
    OR COALESCE(extract(dow FROM d.day)::integer=CASE s."weekOffDay2" WHEN 'SUNDAY' THEN 0 WHEN 'MONDAY' THEN 1 WHEN 'TUESDAY' THEN 2 WHEN 'WEDNESDAY' THEN 3 WHEN 'THURSDAY' THEN 4 WHEN 'FRIDAY' THEN 5 WHEN 'SATURDAY' THEN 6 END
     AND (cardinality(s."weekOff2Weeks")=0 OR (floor((extract(day FROM d.day)::integer-1)/7.0)::integer+1)=ANY(s."weekOff2Weeks")),false)) AS working
  FROM schedules s CROSS JOIN LATERAL generate_series(s."startDate"::timestamp,last_day::timestamp,interval '1 day') d(day)
 ), rotated AS MATERIALIZED (
  SELECT c.id,c.day,c.working,sum(c.working::integer) OVER(PARTITION BY c.id ORDER BY c.day ROWS UNBOUNDED PRECEDING)-1 AS position FROM calendar c
 ), requested AS (
  SELECT staff.id,d.day::date AS day,COALESCE(a."scheduleId",(SELECT def.id FROM default_schedule def)) AS schedule
  FROM staff CROSS JOIN generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
  LEFT JOIN LATERAL (SELECT x."scheduleId" FROM assignments x WHERE x."staffProfileId"=staff.id AND x."startDate"<=d.day::date AND (x."endDate" IS NULL OR x."endDate">=d.day::date) ORDER BY x."startDate" DESC,x.id DESC LIMIT 1) a ON true
 )
 SELECT req.id,req.day,template."startTime",template."endTime",COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',pause."startTime",'endTime',pause."endTime") ORDER BY pause."sortOrder",pause.id) FROM public."ShiftTemplateBreak" pause WHERE pause."templateId"=template.id),'[]'::jsonb)
 FROM requested req JOIN rotated r ON r.id=req.schedule AND r.day=req.day AND r.working
 JOIN blocks b ON b."scheduleId"=r.id AND b.cycle>0 AND mod(r.position,b.cycle)>=b.through-b."repeatDays" AND mod(r.position,b.cycle)<b.through
 JOIN public."ShiftTemplate" template ON template.id=b."templateId" AND template."tenantId"=t
 ORDER BY req.id,req.day;
END $$;
COMMIT;
