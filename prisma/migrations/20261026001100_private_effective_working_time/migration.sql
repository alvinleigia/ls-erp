BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Working-time projection requires the migration owner with BYPASSRLS'; END IF;
END $$;

-- Integrity only. Hidden source records retain their precedence. This returns
-- timings for requested staff/dates, never source identities, labels or causes.
CREATE FUNCTION app.effective_working_time(t text,profiles text[],first_day date,last_day date)
RETURNS TABLE("staffProfileId" text,date date,slots jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE standard_profiles text[]; standard_days jsonb:='{}'::jsonb;
BEGIN
 PERFORM app.require_working_time_access(t);
 IF profiles IS NULL OR cardinality(profiles)>200 OR array_position(profiles,NULL) IS NOT NULL
 OR first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>365
 THEN RAISE EXCEPTION 'Invalid working-time selection' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(profiles) p(id) WHERE NOT EXISTS(SELECT 1 FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE s.id=p.id AND u."tenantId"=t)) THEN RAISE EXCEPTION 'Working-time access is not permitted' USING ERRCODE='42501'; END IF;

 SELECT array_agg(p.id) INTO standard_profiles FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId"
 WHERE u."tenantId"=t AND p.id=ANY(profiles) AND p."schedulingMode"='STANDARD';
 IF cardinality(standard_profiles)>0 THEN
  SELECT COALESCE(jsonb_object_agg(s."staffProfileId"||':'||s.date::text,
   jsonb_build_array(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks',s.breaks))),'{}'::jsonb)
  INTO standard_days FROM app.standard_working_time(t,standard_profiles,first_day,last_day) s;
 END IF;

 RETURN QUERY
 SELECT p.id,d.day::date,
  CASE WHEN overriding.id IS NOT NULL THEN
   CASE WHEN template.id IS NULL THEN '[]'::jsonb ELSE
    jsonb_build_array(jsonb_build_object('startTime',template."startTime",'endTime',template."endTime",'breaks',
     COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',b."startTime",'endTime',b."endTime") ORDER BY b."sortOrder",b.id)
      FROM public."ShiftTemplateBreak" b WHERE b."templateId"=template.id),'[]'::jsonb))) END
  WHEN p."schedulingMode"='FLEXIBLE' THEN app.history_flexible_slots(p.id,d.day::date)
  ELSE COALESCE(standard_days->(p.id||':'||d.day::date::text),'[]'::jsonb) END
 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" AND u."tenantId"=t
 CROSS JOIN generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
 LEFT JOIN public."StaffShiftOverride" overriding ON overriding."staffProfileId"=p.id AND overriding.date=d.day::date
 LEFT JOIN public."ShiftTemplate" template ON template.id=overriding."templateId" AND template."tenantId"=t
 WHERE p.id=ANY(profiles) ORDER BY p.id,d.day;
END $$;
COMMIT;
