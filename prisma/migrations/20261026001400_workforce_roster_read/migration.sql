BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Roster projection requires BYPASSRLS';END IF;
END $$;
-- A private predicate for the bounded roster lookup, not a directory permission.
CREATE FUNCTION app.roster_staff_visible(t text,staff text,first_day date,last_day date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" a WHERE a."tenantId"=t AND a."staffProfileId"=staff AND a."canceledAt" IS NULL AND (a."startDate" IS NULL OR a."startDate"<=last_day) AND (a."endDate" IS NULL OR a."endDate">=first_day) AND app.business_office_access(t,a."officeId",nullif(current_setting('app.actor_id',true),'')))
 OR EXISTS(SELECT 1 FROM public."StaffRosterHistoryDay" h WHERE h."tenantId"=t AND h."staffProfileId"=staff AND h.date BETWEEN first_day AND last_day AND app.roster_history_readable(t,staff,h."officeId",h.id))
 OR (EXISTS(SELECT 1 FROM public."User" actor WHERE actor."tenantId"=t AND actor.id=nullif(current_setting('app.actor_id',true),'') AND actor.role='ADMIN') AND NOT EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" a WHERE a."tenantId"=t AND a."staffProfileId"=staff AND a."canceledAt" IS NULL))
$$;
REVOKE ALL ON FUNCTION app.roster_staff_visible(text,text,date,date) FROM PUBLIC;
CREATE FUNCTION app.roster_staff_page(t text,first_day date,last_day date,q text,n integer,skip integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE result jsonb;BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftRoster.read'),false) THEN RAISE EXCEPTION 'Roster browsing access is not permitted' USING ERRCODE='42501';END IF;
 IF first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>61 OR n IS NULL OR n<1 OR n>100 OR skip IS NULL OR skip<0 OR skip>1000000 OR q IS NULL OR length(q)>160 THEN RAISE EXCEPTION 'Invalid roster selection' USING ERRCODE='22023';END IF;
 WITH eligible AS MATERIALIZED (
  SELECT u.id,u.name,u.email,u.status,p.id AS profile,p."schedulingMode" FROM public."User" u JOIN public."StaffProfile" p ON p."userId"=u.id
  WHERE u."tenantId"=t AND u.role='STAFF' AND (q='' OR u.name ILIKE '%'||q||'%' OR u.email ILIKE '%'||q||'%') AND app.roster_staff_visible(t,p.id,first_day,last_day)
 ), page AS (SELECT * FROM eligible ORDER BY name NULLS LAST,id LIMIT n OFFSET skip)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'status',status,'staffProfileId',profile,'staffProfile',jsonb_build_object('schedulingMode',"schedulingMode")) ORDER BY name NULLS LAST,id) FROM page),'[]'::jsonb),'total',(SELECT count(*) FROM eligible)) INTO result;
 RETURN result;
END $$;
-- Roster Read authorizes neutral hours only within readable dated workplaces.
-- Hidden configuration identifiers, names and private leave causes never leave.
CREATE FUNCTION app.roster_days(t text,profiles text[],first_day date,last_day date)
RETURNS TABLE("staffProfileId" text,date date,state text,slots jsonb,"paidMinutes" integer,frozen boolean,"canEdit" boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE staff text;d date;o text;h public."StaffRosterHistoryDay"%ROWTYPE;today date;live jsonb:='{}'::jsonb;blocked jsonb:='{}'::jsonb;readable boolean;edit_allowed boolean;BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftRoster.read'),false) THEN RAISE EXCEPTION 'Roster browsing access is not permitted' USING ERRCODE='42501';END IF;
 IF profiles IS NULL OR cardinality(profiles)>100 OR array_position(profiles,NULL) IS NOT NULL OR first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>61 THEN RAISE EXCEPTION 'Invalid roster selection' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM unnest(profiles) selected(id) WHERE NOT EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=selected.id AND u."tenantId"=t AND u.role='STAFF') OR NOT app.roster_staff_visible(t,selected.id,first_day,last_day)) THEN RAISE EXCEPTION 'Roster browsing access is not permitted' USING ERRCODE='42501';END IF;
 today:=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),now())::date;
 edit_allowed:=COALESCE(app.workforce_capability(t,'shiftRoster.edit') OR app.workforce_capability(t,'shiftPlans.create') OR app.workforce_capability(t,'shiftPlans.edit'),false);
 IF cardinality(profiles)>0 AND last_day>=today THEN
  SELECT COALESCE(jsonb_object_agg(s."staffProfileId"||':'||s.date::text,s.slots),'{}'::jsonb) INTO live FROM app.effective_working_time(t,profiles,greatest(first_day,today),last_day) s;
  SELECT COALESCE(jsonb_object_agg(b."staffProfileId"||':'||d.day::date::text,true),'{}'::jsonb) INTO blocked FROM app.approved_leave_blocks(t,profiles,greatest(first_day,today),last_day) b CROSS JOIN LATERAL generate_series(b."startDate"::timestamp,b."endDate"::timestamp,interval '1 day') d(day);
 END IF;
 FOREACH staff IN ARRAY profiles LOOP
  FOR d IN SELECT day::date FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') day LOOP
   "staffProfileId":=staff;date:=d;slots:='[]'::jsonb;"paidMinutes":=NULL;frozen:=false;"canEdit":=false;
   o:=app.workplace_on_day(t,staff,d);readable:=COALESCE(app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),'')),false);
   IF d<today THEN
    SELECT * INTO h FROM public."StaffRosterHistoryDay" history WHERE history."tenantId"=t AND history."staffProfileId"=staff AND history.date=d AND app.roster_history_readable(t,staff,history."officeId",history.id);
    IF h.id IS NOT NULL THEN
     frozen:=true;"paidMinutes":=h."paidMinutes";state:=CASE WHEN h."paidMinutes">0 THEN 'WORKING' ELSE 'NONWORKING' END;
     IF h."paidMinutes">0 AND h."startTime" IS NOT NULL AND h."endTime" IS NOT NULL THEN slots:=jsonb_build_array(jsonb_build_object('startTime',h."startTime",'endTime',h."endTime",'breaks','[]'::jsonb));END IF;
    ELSE state:=CASE WHEN o IS NULL THEN 'UNPLACED' WHEN NOT readable THEN 'OUTSIDE' ELSE 'MISSING' END;END IF;
   ELSIF o IS NULL THEN state:='UNPLACED';
   ELSIF NOT readable THEN state:='OUTSIDE';
   ELSE
    slots:=CASE WHEN blocked ? (staff||':'||d::text) THEN '[]'::jsonb ELSE COALESCE(live->(staff||':'||d::text),'[]'::jsonb) END;
    "paidMinutes":=app.work_minutes(slots);state:=CASE WHEN "paidMinutes">0 THEN 'WORKING' ELSE 'NONWORKING' END;
    "canEdit":=edit_allowed AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),''));
   END IF;
   RETURN NEXT;
  END LOOP;
 END LOOP;
END $$;
COMMIT;
