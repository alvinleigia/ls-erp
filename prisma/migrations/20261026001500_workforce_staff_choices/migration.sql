BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Workforce choices require BYPASSRLS'; END IF;
END $$;
-- This lookup never grants a write. Native ownership, coverage, overlap and
-- booking guards still run independently in the mutation transaction.
CREATE FUNCTION app.workforce_staff_choices(t text,family text,action text,source text,first_day date,last_day date,selected text[],q text,n integer,skip integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off SET jit=off AS $$
DECLARE resource text; o text; caller text:=nullif(current_setting('app.actor_id',true),''); result jsonb; retained_profiles text[]:=ARRAY[]::text[]; BEGIN
 IF family NOT IN ('SCHEDULE','PATTERN') OR family IS NULL OR action NOT IN ('browse','create','edit') OR action IS NULL OR n IS NULL OR n NOT BETWEEN 1 AND 100 OR skip IS NULL OR skip NOT BETWEEN 0 AND 1000000 OR q IS NULL OR length(q)>160 OR selected IS NULL OR cardinality(selected)>100 OR array_position(selected,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Invalid workforce staff selection' USING ERRCODE='22023';END IF;
 resource:=CASE family WHEN 'SCHEDULE' THEN 'shiftSchedules' ELSE 'shiftPlans' END;
 IF NOT COALESCE(app.workforce_capability(t,resource||'.read'),false) OR (action<>'browse' AND NOT COALESCE(app.workforce_capability(t,resource||'.'||action),false)) THEN RAISE EXCEPTION 'Workforce staff choices access is not permitted' USING ERRCODE='42501';END IF;
 IF action='browse' THEN
  IF source IS NOT NULL THEN RAISE EXCEPTION 'Invalid workforce staff selection' USING ERRCODE='22023';END IF;
 ELSE
  IF first_day IS NULL OR NOT isfinite(first_day) OR (last_day IS NOT NULL AND (NOT isfinite(last_day) OR last_day<first_day)) THEN RAISE EXCEPTION 'Invalid workforce staff selection' USING ERRCODE='22023';END IF;
  IF action='edit' THEN
   IF family='SCHEDULE' THEN SELECT s."officeId" INTO o FROM public."ShiftSchedule" s WHERE s."tenantId"=t AND s.id=source AND app.schedule_readable(t,s.id);
   ELSE SELECT p."officeId" INTO o FROM public."StaffFlexiblePattern" p WHERE p."tenantId"=t AND p.id=source AND app.flexible_readable(t,p."officeId",'PATTERN');END IF;
   IF o IS NULL THEN RAISE EXCEPTION 'Workforce staff source not found' USING ERRCODE='P0002';END IF;
  ELSE
   IF source IS NOT NULL THEN RAISE EXCEPTION 'Invalid workforce staff selection' USING ERRCODE='22023';END IF;
   o:=app.creation_office_id();
   IF o IS NULL OR nullif(current_setting('app.office_version',true),'') IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501';END IF;
   IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=caller AND p."creationOfficeId"=o AND p.version::text=current_setting('app.office_version',true)) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001';END IF;
  END IF;
  IF NOT COALESCE(app.business_office_allowed(t,o,caller),false) THEN RAISE EXCEPTION 'Workforce staff choices access is not permitted' USING ERRCODE='42501';END IF;
 END IF;
 -- Resolve source visibility once, rather than repeating it for each person.
 IF action<>'create' THEN
 IF family='SCHEDULE' THEN
  SELECT COALESCE(array_agg(DISTINCT a."staffProfileId"),ARRAY[]::text[]) INTO retained_profiles FROM public."StaffScheduleAssignment" a JOIN public."ShiftSchedule" s ON s.id=a."scheduleId" WHERE s."tenantId"=t AND ((action='browse' AND app.business_office_access(t,s."officeId",caller)) OR (action='edit' AND s.id=source));
 ELSE
  SELECT COALESCE(array_agg(DISTINCT r."staffProfileId"),ARRAY[]::text[]) INTO retained_profiles FROM public."StaffFlexiblePattern" r WHERE r."tenantId"=t AND ((action='browse' AND app.flexible_readable(t,r."officeId",'PATTERN')) OR (action='edit' AND r.id=source));
 END IF;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT u.id,u.name,u.email,p."schedulingMode",
   CASE WHEN action='browse' THEN false
    ELSE u.status='ACTIVE' AND p."schedulingMode"::text=CASE family WHEN 'SCHEDULE' THEN 'STANDARD' ELSE 'FLEXIBLE' END AND (family='SCHEDULE' OR u.role='STAFF')
     AND EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" w WHERE w."tenantId"=t AND w."staffProfileId"=p.id AND w."officeId"=o AND w."canceledAt" IS NULL AND (w."startDate" IS NULL OR w."startDate"<=first_day) AND (w."endDate" IS NULL OR (last_day IS NOT NULL AND w."endDate">=last_day)))
     AND app.office_membership_exists(t,o,u.id) END eligible,
   p.id=ANY(retained_profiles) retained
  FROM public."User" u JOIN public."StaffProfile" p ON p."userId"=u.id WHERE u."tenantId"=t AND (action<>'browse' OR p.id=ANY(retained_profiles)) AND (q='' OR u.name ILIKE '%'||q||'%' OR u.email ILIKE '%'||q||'%' OR u.id=ANY(selected))
 ), visible AS MATERIALIZED (SELECT *,jsonb_build_object('id',id,'name',name,'email',email,'staffProfile',jsonb_build_object('schedulingMode',"schedulingMode"),'eligible',eligible,'retained',retained) dto FROM candidates WHERE (action='browse' AND retained) OR (action<>'browse' AND (eligible OR retained))),
 matching AS MATERIALIZED (SELECT * FROM visible WHERE q='' OR name ILIKE '%'||q||'%' OR email ILIKE '%'||q||'%'), page AS (SELECT * FROM matching ORDER BY name NULLS LAST,id LIMIT n OFFSET skip)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(dto ORDER BY name NULLS LAST,id) FROM page),'[]'::jsonb),'selected',COALESCE((SELECT jsonb_agg(dto ORDER BY name NULLS LAST,id) FROM visible WHERE id=ANY(selected)),'[]'::jsonb),'total',(SELECT count(*) FROM matching)) INTO result;
 RETURN result;
END $$;
COMMIT;
