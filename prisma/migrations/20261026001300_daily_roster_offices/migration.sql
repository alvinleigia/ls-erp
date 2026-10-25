BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Daily roster migration requires BYPASSRLS'; END IF;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['StaffShiftOverride','StaffFlexibleAvailability'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN "tenantId" text,ADD COLUMN "officeId" text',tbl);
  EXECUTE format('UPDATE %I r SET "tenantId"=u."tenantId","officeId"=o.id FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE p.id=r."staffProfileId"',tbl);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenantId" SET NOT NULL,ALTER COLUMN "officeId" SET NOT NULL,ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id()',tbl);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED',tbl,tbl||'_tenantId_officeId_fkey');
  EXECUTE format('CREATE INDEX %I ON %I("tenantId","officeId")',tbl||'_tenantId_officeId_idx',tbl);
 END LOOP;
END $$;
CREATE FUNCTION app.daily_readable(t text,o text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.workforce_capability(t,'shiftRoster.read') AND app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))
$$;
CREATE FUNCTION app.daily_creation_office(t text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o text:=app.creation_office_id();u text:=nullif(current_setting('app.actor_id',true),'');expected_version text:=nullif(current_setting('app.office_version',true),'');BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftRoster.read'),false) OR o IS NULL OR expected_version IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501';END IF;
 IF NOT app.business_office_allowed(t,o,u) THEN RAISE EXCEPTION 'Daily roster office access is not permitted' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=u AND p."creationOfficeId"=o AND p.version::text=expected_version) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001';END IF;
 RETURN o;
END $$;
CREATE FUNCTION app.daily_coverage(t text,o text,staff text,d date,family text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT family IN ('SLOT','OVERRIDE') AND d IS NOT NULL AND isfinite(d) AND app.workplace_on_day(t,staff,d)=o
 AND EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t AND u.status='ACTIVE' AND u.role IN ('STAFF','MANAGER') AND (family='OVERRIDE' OR (u.role='STAFF' AND p."schedulingMode"='FLEXIBLE')) AND app.office_assignment_allowed(t,o,u.id))
$$;
REVOKE ALL ON FUNCTION app.daily_coverage(text,text,text,date,text) FROM PUBLIC;
CREATE FUNCTION app.daily_target_allowed(t text,o text,staff text,d date,family text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.daily_readable(t,o) AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')) AND app.daily_coverage(t,o,staff,d,family)
$$;
CREATE FUNCTION app.daily_office_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE payload jsonb;prior jsonb;t text;o text;staff text;d date;family text;op text:=nullif(current_setting('app.workforce_operation',true),'');existing_office text;BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_OP='DELETE' THEN payload:=to_jsonb(OLD);ELSE payload:=to_jsonb(NEW);END IF;
 t:=payload->>'tenantId';o:=payload->>'officeId';staff:=payload->>'staffProfileId';d:=(payload->>'date')::date;family:=CASE TG_TABLE_NAME WHEN 'StaffShiftOverride' THEN 'OVERRIDE' ELSE 'SLOT' END;
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 IF op NOT IN ('shiftRoster.edit','shiftRoster.archive') OR op IS NULL OR t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR NOT COALESCE(app.daily_readable(t,o) AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')) AND app.workforce_capability(t,op),false) OR (TG_OP<>'DELETE' AND op<>'shiftRoster.edit') OR (family='OVERRIDE' AND TG_OP='DELETE' AND op<>'shiftRoster.archive') THEN RAISE EXCEPTION 'Daily roster office access is not permitted' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514';END IF;
 -- Edit can replace/shrink a day's slot list, but clearing its final slot is
 -- Archive. The service inserts replacements before removing old positions.
 IF family='SLOT' AND TG_OP='DELETE' AND op='shiftRoster.edit' AND (SELECT count(*) FROM public."StaffFlexibleAvailability" x WHERE x."tenantId"=t AND x."officeId"=o AND x."staffProfileId"=staff AND x.date=d)<=1 THEN RAISE EXCEPTION 'Daily roster office access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' THEN
  prior:=to_jsonb(OLD);
  IF payload->>'id' IS DISTINCT FROM prior->>'id' OR payload->>'tenantId' IS DISTINCT FROM prior->>'tenantId' OR payload->>'officeId' IS DISTINCT FROM prior->>'officeId' OR payload->>'staffProfileId' IS DISTINCT FROM prior->>'staffProfileId' OR payload->>'date' IS DISTINCT FROM prior->>'date' OR (family='SLOT' AND payload->>'sortOrder' IS DISTINCT FROM prior->>'sortOrder') THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF family='SLOT' THEN SELECT a."officeId" INTO existing_office FROM public."StaffFlexibleAvailability" a WHERE a."staffProfileId"=staff AND a.date=d ORDER BY a.id LIMIT 1;END IF;
  IF existing_office IS NOT NULL THEN
   IF existing_office<>o THEN RAISE EXCEPTION 'A daily roster record already exists outside this operation' USING ERRCODE='40001';END IF;
  ELSE
   IF o IS DISTINCT FROM app.daily_creation_office(t) THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501';END IF;
   IF NOT COALESCE(app.daily_coverage(t,o,staff,d,family),false) THEN RAISE EXCEPTION 'Choose staff placed in this office on the selected date' USING ERRCODE='23514';END IF;
  END IF;
  IF family='OVERRIDE' AND EXISTS(SELECT 1 FROM public."StaffShiftOverride" x WHERE x."staffProfileId"=staff AND x.date=d) THEN RAISE EXCEPTION 'A daily roster record already exists outside this operation' USING ERRCODE='40001';END IF;
 END IF;
 IF family='OVERRIDE' AND TG_OP<>'DELETE' AND payload->>'templateId' IS NOT NULL THEN
  IF NOT COALESCE(app.workforce_capability(t,'shiftTemplates.read'),false) OR NOT EXISTS(SELECT 1 FROM public."ShiftTemplate" template WHERE template.id=payload->>'templateId' AND template."tenantId"=t) THEN RAISE EXCEPTION 'Daily roster template access is not permitted' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
REVOKE ALL ON FUNCTION app.daily_office_owner() FROM PUBLIC;
DO $$ DECLARE tbl text;BEGIN
 FOREACH tbl IN ARRAY ARRAY['StaffShiftOverride','StaffFlexibleAvailability'] LOOP
  EXECUTE format('CREATE POLICY daily_office ON %I AS RESTRICTIVE FOR ALL USING(current_setting(''app.rls_bypass'',true)=''on'' OR app.daily_readable("tenantId","officeId")) WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'' OR app.daily_readable("tenantId","officeId"))',tbl);
  EXECUTE format('CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.daily_office_owner()',tbl);
 END LOOP;
END $$;
UPDATE "AuditLog" a SET metadata=COALESCE(a.metadata,'{}'::jsonb)||jsonb_build_object('officeId',o.id,'officeFamily','dailyRoster') FROM "BusinessOffice" o WHERE a."tenantId"=o."tenantId" AND o."isInitial" AND a."entityType"='shiftRoster' AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.before)='array' THEN a.before ELSE '[]'::jsonb END||CASE WHEN jsonb_typeof(a.after)='array' THEN a.after ELSE '[]'::jsonb END) x WHERE x?'date' AND x?'staffProfileId');
CREATE POLICY daily_office_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING(NOT COALESCE("entityType"='shiftRoster' AND metadata->>'officeFamily'='dailyRoster',false) OR app.daily_readable("tenantId",metadata->>'officeId'));
CREATE FUNCTION app.daily_office_label(t text,family text,k text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o text;BEGIN
 IF family='OVERRIDE' THEN SELECT r."officeId" INTO o FROM public."StaffShiftOverride" r WHERE r."tenantId"=t AND r.id=k;
 ELSIF family='SLOT' THEN SELECT r."officeId" INTO o FROM public."StaffFlexibleAvailability" r WHERE r."tenantId"=t AND r.id=k;END IF;
 IF NOT COALESCE(app.daily_readable(t,o),false) THEN RETURN NULL;END IF;
 RETURN(SELECT jsonb_build_object('id',office.id,'name',office.name,'companyName',company.name,'active',NOT(office.archived OR company.archived)) FROM public."BusinessOffice" office JOIN public."BusinessCompany" company ON company."tenantId"=office."tenantId" AND company.id=office."companyId" WHERE office."tenantId"=t AND office.id=o);
END $$;

-- Selection-only projection for bulk overrides. Source schedules stay private;
-- dated workplace, assignments and local defaults decide each day's week-off.
CREATE FUNCTION app.override_workdays(t text,staff text,first_day date,last_day date) RETURNS TABLE(date date) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE d date;o text;s public."ShiftSchedule"%ROWTYPE;weekday text;BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftRoster.edit'),false) OR NOT EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t) THEN RAISE EXCEPTION 'Daily roster office access is not permitted' USING ERRCODE='42501';END IF;
 IF first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>365 THEN RAISE EXCEPTION 'Invalid daily roster selection' USING ERRCODE='22023';END IF;
 FOR d IN SELECT day::date FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') day LOOP
  o:=app.workplace_on_day(t,staff,d);
  IF NOT COALESCE(app.daily_readable(t,o) AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Daily roster office access is not permitted' USING ERRCODE='42501';END IF;
  SELECT source.* INTO s FROM public."StaffScheduleAssignment" a JOIN public."ShiftSchedule" source ON source.id=a."scheduleId" AND source."tenantId"=t AND source."officeId"=o WHERE a."staffProfileId"=staff AND a."startDate"<=d AND (a."endDate" IS NULL OR a."endDate">=d) ORDER BY a."startDate" DESC,a.id DESC LIMIT 1;
  IF s.id IS NULL THEN SELECT * INTO s FROM public."ShiftSchedule" source WHERE source."tenantId"=t AND source."officeId"=o AND source."isDefault";END IF;
  weekday:=(ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])[extract(dow FROM d)::integer+1];
  IF s.id IS NULL OR s."startDate">d OR (weekday<>s."weekOffDay1"::text AND NOT COALESCE(weekday=s."weekOffDay2"::text AND (cardinality(s."weekOff2Weeks")=0 OR floor((extract(day FROM d)::integer-1)/7.0)::integer+1=ANY(s."weekOff2Weeks")),false)) THEN date:=d;RETURN NEXT;END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.history_flexible_slots(staff text,d date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE key_day public."Weekday":=(ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])[extract(dow FROM d)::integer+1]::public."Weekday"; day_id text; is_off boolean; slots jsonb; pattern public."StaffFlexiblePattern"%ROWTYPE; idx integer; t text; o text;
BEGIN
 SELECT u."tenantId" INTO t FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff;
 o:=app.workplace_on_day(t,staff,d);
 SELECT day.id,day."isOff" INTO day_id,is_off FROM public."StaffFlexibleWeekDay" day JOIN public."StaffFlexibleWeekPlan" plan ON plan.id=day."planId" WHERE plan."tenantId"=t AND plan."officeId"=o AND plan."staffProfileId"=staff AND plan."weekStartDate"=date_trunc('week',d::timestamp)::date AND day.day=key_day;
 IF is_off THEN RETURN '[]'::jsonb; END IF;
 SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks',COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',b."startTime",'endTime',b."endTime")) FROM public."StaffFlexibleWeekBreak" b WHERE b."slotId"=s.id),'[]'::jsonb)) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexibleWeekSlot" s WHERE s."dayId"=day_id;
 IF jsonb_array_length(slots)>0 THEN RETURN slots; END IF;
 SELECT * INTO pattern FROM public."StaffFlexiblePattern" p WHERE p."tenantId"=t AND p."officeId"=o AND p."staffProfileId"=staff AND p."isActive" AND p."validFrom"<=d AND (p."validTo" IS NULL OR p."validTo">=d) ORDER BY p."validFrom" DESC,p."createdAt" DESC,p.id DESC LIMIT 1;
 IF pattern.id IS NOT NULL THEN
  idx:=((d-pattern."validFrom")/7)%pattern."cycleLengthWeeks"+1;
  SELECT day.id,day."isOff" INTO day_id,is_off FROM public."StaffFlexiblePatternDay" day JOIN public."StaffFlexiblePatternWeek" week ON week.id=day."weekId" WHERE week."patternId"=pattern.id AND week."weekIndex"=idx AND day.day=key_day;
  IF is_off THEN RETURN '[]'::jsonb; END IF;
  SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks',COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',b."startTime",'endTime',b."endTime")) FROM public."StaffFlexiblePatternBreak" b WHERE b."slotId"=s.id),'[]'::jsonb)) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexiblePatternSlot" s WHERE s."dayId"=day_id;
  IF jsonb_array_length(slots)>0 THEN RETURN slots; END IF;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks','[]'::jsonb) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexibleAvailability" s WHERE s."tenantId"=t AND s."officeId"=o AND s."staffProfileId"=staff AND s.date=d;
 RETURN COALESCE(slots,'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION app.sync_roster_history(t text,profiles text[],first_day date,last_day date,replace_existing boolean) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE staff record; d date; o text; caller text:=nullif(current_setting('app.actor_id',true),''); own_person boolean; allowed boolean; rows_changed integer:=0; n integer; sources jsonb; details jsonb; slots jsonb; template public."ShiftTemplate"%ROWTYPE; overriding public."StaffShiftOverride"%ROWTYPE; kind public."StaffRosterDaySource"; paid integer; first_time text; last_time text; template_id text; template_name text; request public."LeaveRequest"%ROWTYPE; template_write boolean; schedule_write boolean; plan_write boolean; roster_write boolean; roster_read boolean; own_read boolean; own_archive boolean; approval_write boolean; office_rights jsonb:='{}'::jsonb; office_ok boolean;
BEGIN
 IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') THEN RAISE EXCEPTION 'Roster history access is not permitted' USING ERRCODE='42501'; END IF;
 IF profiles IS NULL OR cardinality(profiles)>200 OR array_position(profiles,NULL) IS NOT NULL OR first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>365 OR replace_existing IS NULL THEN RAISE EXCEPTION 'Invalid history selection' USING ERRCODE='22023'; END IF;
 IF last_day>=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),now())::date THEN RAISE EXCEPTION 'History capture is limited to past dates' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(profiles) p(id) WHERE NOT EXISTS(SELECT 1 FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE s.id=p.id AND u."tenantId"=t)) THEN RAISE EXCEPTION 'Roster history access is not permitted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 template_write:=COALESCE(app.workforce_capability(t,'shiftTemplates.edit'),false);
 schedule_write:=COALESCE(app.workforce_capability(t,'shiftSchedules.create') OR app.workforce_capability(t,'shiftSchedules.edit') OR app.workforce_capability(t,'shiftSchedules.archive'),false);
 plan_write:=COALESCE(app.workforce_capability(t,'shiftPlans.create') OR app.workforce_capability(t,'shiftPlans.edit') OR app.workforce_capability(t,'shiftPlans.archive'),false);
 roster_write:=COALESCE(app.workforce_capability(t,'shiftRoster.edit') OR app.workforce_capability(t,'shiftRoster.archive'),false);
 roster_read:=COALESCE(app.workforce_capability(t,'shiftRoster.read'),false);
 own_read:=COALESCE(app.leave_capability(t,caller,'leaveRequests.read'),false);own_archive:=COALESCE(app.leave_capability(t,caller,'leaveRequests.archive'),false);
 approval_write:=COALESCE(app.leave_capability(t,caller,'leaveApprovals.approve') OR app.leave_capability(t,caller,'leaveApprovals.archive'),false);
 IF NOT (template_write OR schedule_write OR plan_write OR roster_write OR roster_read OR own_read OR approval_write) THEN RAISE EXCEPTION 'Roster history access is not permitted' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_object_agg(s."staffProfileId"||':'||s.date::text,to_jsonb(s)),'{}'::jsonb) INTO sources FROM app.standard_day_sources(t,profiles,first_day,last_day) s;
 FOR staff IN SELECT s.id,s."userId",s."schedulingMode" FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE u."tenantId"=t AND s.id=ANY(profiles) LOOP
  own_person:=staff."userId"=caller;
  FOR d IN SELECT day::date FROM generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') day LOOP
   IF NOT replace_existing AND EXISTS(SELECT 1 FROM public."StaffRosterHistoryDay" h WHERE h."staffProfileId"=staff.id AND h.date=d) THEN CONTINUE; END IF;
   SELECT * INTO request FROM public."LeaveRequest" r WHERE r."tenantId"=t AND r."staffProfileId"=staff.id AND r."startDate"<=d AND r."endDate">=d ORDER BY (r.status='APPROVED') DESC,r."createdAt",r.id LIMIT 1;
   o:=app.workplace_on_day(t,staff.id,d);
   IF o IS NULL AND request.id IS NOT NULL THEN o:=request."officeId"; END IF;
   IF o IS NULL THEN CONTINUE; END IF; -- An unplaced profile has no invented office or historical default.
   IF NOT (office_rights ? o) THEN office_rights:=office_rights||jsonb_build_object(o,COALESCE(app.business_office_access(t,o,caller),false)); END IF;
   office_ok:=(office_rights->>o)::boolean;
   allowed:=(NOT replace_existing AND template_write) OR (office_ok AND (roster_write OR (NOT replace_existing AND (schedule_write OR plan_write))))
    OR (NOT replace_existing AND roster_read AND (own_person OR office_ok)) OR (own_person AND ((NOT replace_existing AND own_read) OR own_archive))
    OR (request.id IS NOT NULL AND approval_write AND app.leave_reader(t,request."officeId",staff.id,caller));
   IF NOT COALESCE(allowed,false) THEN CONTINUE; END IF;
   IF replace_existing AND EXISTS(SELECT 1 FROM public."StaffRosterHistoryDay" h WHERE h."staffProfileId"=staff.id AND h.date=d AND h."officeId"<>o) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
   details:=sources->(staff.id||':'||d::text);slots:='[]'::jsonb;kind:='OFF';template_id:=NULL;template_name:=NULL;first_time:=NULL;last_time:=NULL;
   SELECT * INTO overriding FROM public."StaffShiftOverride" x WHERE x."tenantId"=t AND x."officeId"=o AND x."staffProfileId"=staff.id AND x.date=d;
   IF overriding.id IS NOT NULL THEN
    SELECT * INTO template FROM public."ShiftTemplate" x WHERE x.id=overriding."templateId" AND x."tenantId"=t;
    IF template.id IS NOT NULL THEN
     kind:='OVERRIDE';template_id:=template.id;template_name:=template.name;first_time:=template."startTime";last_time:=template."endTime";
     SELECT jsonb_build_array(jsonb_build_object('startTime',first_time,'endTime',last_time,'breaks',COALESCE(jsonb_agg(jsonb_build_object('startTime',b."startTime",'endTime',b."endTime")) FILTER(WHERE b.id IS NOT NULL),'[]'::jsonb))) INTO slots FROM public."ShiftTemplateBreak" b WHERE b."templateId"=template_id;
    ELSE kind:='UNAVAILABLE'; END IF;
   ELSIF staff."schedulingMode"='FLEXIBLE' THEN
    slots:=app.history_flexible_slots(staff.id,d);paid:=app.work_minutes(slots);
    IF paid>0 THEN kind:='SCHEDULE';template_name:='Flexible';SELECT min(s->>'startTime'),max(s->>'endTime') INTO first_time,last_time FROM jsonb_array_elements(slots) s; ELSE slots:='[]'::jsonb; END IF;
   ELSIF details IS NOT NULL THEN
    kind:='SCHEDULE';template_id:=details->>'templateId';template_name:=details->>'templateName';first_time:=details->>'startTime';last_time:=details->>'endTime';slots:=jsonb_build_array(details);
   END IF;
   paid:=app.work_minutes(slots);
   INSERT INTO public."StaffRosterHistoryDay"(id,"tenantId","officeId","staffProfileId",date,source,"templateId","templateName","startTime","endTime","paidMinutes","updatedAt") VALUES(gen_random_uuid()::text,t,o,staff.id,d,kind,template_id,template_name,first_time,last_time,paid,timezone('UTC',clock_timestamp()))
   ON CONFLICT("staffProfileId",date) DO UPDATE SET source=excluded.source,"templateId"=excluded."templateId","templateName"=excluded."templateName","startTime"=excluded."startTime","endTime"=excluded."endTime","paidMinutes"=excluded."paidMinutes","updatedAt"=excluded."updatedAt" WHERE replace_existing;
   GET DIAGNOSTICS n=ROW_COUNT;rows_changed:=rows_changed+n;
  END LOOP;
 END LOOP;
 RETURN rows_changed;
END $$;

CREATE OR REPLACE FUNCTION app.effective_working_time(t text,profiles text[],first_day date,last_day date)
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
 LEFT JOIN public."StaffShiftOverride" overriding ON overriding."tenantId"=t AND overriding."officeId"=app.workplace_on_day(t,p.id,d.day::date) AND overriding."staffProfileId"=p.id AND overriding.date=d.day::date
 LEFT JOIN public."ShiftTemplate" template ON template.id=overriding."templateId" AND template."tenantId"=t
 WHERE p.id=ANY(profiles) ORDER BY p.id,d.day;
END $$;
COMMIT;
