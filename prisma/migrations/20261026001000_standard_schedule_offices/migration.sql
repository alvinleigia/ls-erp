BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Schedule office migration requires BYPASSRLS'; END IF;
 IF EXISTS(SELECT 1 FROM "ShiftSchedule" s WHERE s."tenantId" IS NULL OR NOT EXISTS(SELECT 1 FROM "BusinessOffice" o WHERE o."tenantId"=s."tenantId" AND o."isInitial")) THEN RAISE EXCEPTION 'Schedule tenant or initial office is missing'; END IF;
 IF EXISTS(SELECT 1 FROM "StaffScheduleAssignment" a JOIN "StaffProfile" p ON p.id=a."staffProfileId" JOIN "User" u ON u.id=p."userId" JOIN "ShiftSchedule" s ON s.id=a."scheduleId" WHERE u."tenantId" IS DISTINCT FROM s."tenantId") THEN RAISE EXCEPTION 'Schedule assignment tenant identities disagree'; END IF;
END $$;
ALTER TABLE "ShiftSchedule" ADD COLUMN "officeId" text;
UPDATE "ShiftSchedule" s SET "officeId"=o.id FROM "BusinessOffice" o WHERE o."tenantId"=s."tenantId" AND o."isInitial";
ALTER TABLE "ShiftSchedule" ALTER COLUMN "tenantId" SET NOT NULL,ALTER COLUMN "officeId" SET NOT NULL,ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id();
ALTER TABLE "ShiftSchedule" ADD CONSTRAINT "ShiftSchedule_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "ShiftSchedule_tenantId_officeId_idx" ON "ShiftSchedule"("tenantId","officeId");
DROP INDEX "ShiftSchedule_tenant_default_unique";
CREATE UNIQUE INDEX "ShiftSchedule_default_unique" ON "ShiftSchedule"("tenantId","officeId") WHERE "isDefault";
ALTER TABLE "StaffRosterHistoryDay" ADD COLUMN "tenantId" text,ADD COLUMN "officeId" text;
ALTER TABLE "StaffRosterHistoryDay" DISABLE TRIGGER private_leave_before;
ALTER TABLE "StaffRosterHistoryDay" DISABLE TRIGGER private_leave_after;
UPDATE "StaffRosterHistoryDay" h SET "tenantId"=u."tenantId","officeId"=o.id FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE p.id=h."staffProfileId";
ALTER TABLE "StaffRosterHistoryDay" ENABLE TRIGGER private_leave_before;
ALTER TABLE "StaffRosterHistoryDay" ENABLE TRIGGER private_leave_after;
ALTER TABLE "StaffRosterHistoryDay" ALTER COLUMN "tenantId" SET NOT NULL,ALTER COLUMN "officeId" SET NOT NULL;
ALTER TABLE "StaffRosterHistoryDay" ADD CONSTRAINT "StaffRosterHistoryDay_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "StaffRosterHistoryDay_tenantId_officeId_idx" ON "StaffRosterHistoryDay"("tenantId","officeId");

CREATE FUNCTION app.workforce_capability(t text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND p=ANY(ARRAY['shiftSchedules.read','shiftSchedules.create','shiftSchedules.edit','shiftSchedules.archive','shiftTemplates.read','shiftTemplates.create','shiftTemplates.edit','shiftTemplates.archive','shiftPlans.read','shiftPlans.create','shiftPlans.edit','shiftPlans.archive','shiftRoster.read','shiftRoster.edit','shiftRoster.archive']) AND EXISTS(
 SELECT 1 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" JOIN public."TenantModule" m ON m."tenantId"=tenant.id AND m.key='shifts' AND m.allowed AND m.enabled WHERE tenant.id=t AND tenant.status='ACTIVE' AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id AND policy.rules->>p='ALL' AND policy.rules->>(split_part(p,'.',1)||'.read')='ALL'
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions)))))
$$;
REVOKE ALL ON FUNCTION app.workforce_capability(text,text) FROM PUBLIC;
CREATE FUNCTION app.workplace_on_day(t text,staff text,d date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT a."officeId" FROM public."StaffWorkplaceAssignment" a WHERE a."tenantId"=t AND a."staffProfileId"=staff AND a."canceledAt" IS NULL AND (a."startDate" IS NULL OR a."startDate"<=d) AND (a."endDate" IS NULL OR a."endDate">=d) ORDER BY a."startDate" DESC NULLS LAST,a.id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.workplace_on_day(text,text,date) FROM PUBLIC;
CREATE FUNCTION app.schedule_readable(t text,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.workforce_capability(t,'shiftSchedules.read') AND EXISTS(SELECT 1 FROM public."ShiftSchedule" s WHERE s."tenantId"=t AND s.id=k AND app.business_office_access(t,s."officeId",nullif(current_setting('app.actor_id',true),'')))
$$;
CREATE FUNCTION app.schedule_office_readable(t text,o text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.workforce_capability(t,'shiftSchedules.read') AND app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))
$$;
CREATE POLICY schedule_office ON "ShiftSchedule" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.schedule_office_readable("tenantId","officeId")) WITH CHECK(current_setting('app.rls_bypass',true)='on' OR app.schedule_office_readable("tenantId","officeId"));
CREATE FUNCTION app.schedule_child_readable(k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.schedule_readable(nullif(current_setting('app.tenant_id',true),''),k)
$$;
CREATE POLICY schedule_office ON "ShiftScheduleBlock" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.schedule_child_readable("scheduleId")) WITH CHECK(current_setting('app.rls_bypass',true)='on' OR app.schedule_child_readable("scheduleId"));
CREATE POLICY schedule_office ON "StaffScheduleAssignment" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.schedule_child_readable("scheduleId")) WITH CHECK(current_setting('app.rls_bypass',true)='on' OR app.schedule_child_readable("scheduleId"));

CREATE FUNCTION app.schedule_office_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE t text; o text; u text:=nullif(current_setting('app.actor_id',true),''); op text:=nullif(current_setting('app.workforce_operation',true),''); payload jsonb; expected text; permission text; staff text; first_day date; last_day date; narrowing boolean:=false;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN payload:=to_jsonb(OLD); ELSE payload:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='ShiftSchedule' THEN t:=payload->>'tenantId';o:=payload->>'officeId';
 ELSE SELECT s."tenantId",s."officeId" INTO t,o FROM public."ShiftSchedule" s WHERE s.id=payload->>'scheduleId'; END IF;
 IF t IS NULL AND TG_OP='DELETE' AND TG_TABLE_NAME<>'ShiftSchedule' THEN RETURN OLD; END IF; -- FK cascade after an authorized parent deletion.
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 IF op IS NULL OR op NOT IN ('shiftSchedules.create','shiftSchedules.edit','shiftSchedules.archive') OR t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR NOT app.business_office_allowed(t,o,u) THEN RAISE EXCEPTION 'Schedule office access is not permitted' USING ERRCODE='42501'; END IF;
 permission:=CASE WHEN TG_TABLE_NAME='ShiftSchedule' THEN CASE TG_OP WHEN 'INSERT' THEN 'shiftSchedules.create' WHEN 'DELETE' THEN 'shiftSchedules.archive' ELSE 'shiftSchedules.edit' END ELSE op END;
 IF NOT app.workforce_capability(t,permission) THEN RAISE EXCEPTION 'Schedule office access is not permitted' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='ShiftSchedule' AND TG_OP='INSERT' THEN
  expected:=nullif(current_setting('app.office_version',true),'');
  IF o IS NULL OR o IS DISTINCT FROM app.creation_office_id() OR expected IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=u AND p."creationOfficeId"=o AND p.version::text=expected) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='ShiftSchedule' AND (payload->>'id' IS DISTINCT FROM to_jsonb(OLD)->>'id' OR payload->>'tenantId' IS DISTINCT FROM to_jsonb(OLD)->>'tenantId' OR payload->>'officeId' IS DISTINCT FROM to_jsonb(OLD)->>'officeId') THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME<>'ShiftSchedule' AND (payload->>'id' IS DISTINCT FROM to_jsonb(OLD)->>'id' OR payload->>'scheduleId' IS DISTINCT FROM to_jsonb(OLD)->>'scheduleId' OR (TG_TABLE_NAME='StaffScheduleAssignment' AND payload->>'staffProfileId' IS DISTINCT FROM to_jsonb(OLD)->>'staffProfileId')) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='StaffScheduleAssignment' AND TG_OP<>'DELETE' THEN
  staff:=payload->>'staffProfileId';first_day:=(payload->>'startDate')::date;last_day:=(payload->>'endDate')::date;
  IF TG_OP='UPDATE' THEN narrowing:=payload->>'startDate'=to_jsonb(OLD)->>'startDate' AND last_day IS NOT NULL AND ((to_jsonb(OLD)->>'endDate') IS NULL OR last_day<=(to_jsonb(OLD)->>'endDate')::date); END IF;
  IF (NOT narrowing AND (NOT EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" person ON person.id=p."userId" WHERE p.id=staff AND person."tenantId"=t AND person.status='ACTIVE' AND p."schedulingMode"='STANDARD' AND app.office_assignment_allowed(t,o,person.id))
   OR NOT EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" a WHERE a."tenantId"=t AND a."staffProfileId"=staff AND a."officeId"=o AND a."canceledAt" IS NULL AND (a."startDate" IS NULL OR a."startDate"<=first_day) AND (a."endDate" IS NULL OR (last_day IS NOT NULL AND a."endDate">=last_day)))))
   OR (last_day IS NOT NULL AND last_day<first_day) THEN RAISE EXCEPTION 'Choose staff with workplace coverage for the entire assignment' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public."StaffScheduleAssignment" a WHERE a."staffProfileId"=staff AND a.id<>payload->>'id' AND (last_day IS NULL OR a."startDate"<=last_day) AND (a."endDate" IS NULL OR a."endDate">=first_day)) THEN RAISE EXCEPTION 'Selected staff already have schedules assigned in this range' USING ERRCODE='40001'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION app.schedule_office_owner() FROM PUBLIC;
CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE OR DELETE ON "ShiftSchedule" FOR EACH ROW EXECUTE FUNCTION app.schedule_office_owner();
CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE OR DELETE ON "ShiftScheduleBlock" FOR EACH ROW EXECUTE FUNCTION app.schedule_office_owner();
CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE OR DELETE ON "StaffScheduleAssignment" FOR EACH ROW EXECUTE FUNCTION app.schedule_office_owner();

-- Canonical source details remain private to the history writer.
CREATE FUNCTION app.standard_day_sources(t text,profiles text[],first_day date,last_day date)
RETURNS TABLE("staffProfileId" text,date date,"officeId" text,"templateId" text,"templateName" text,"startTime" text,"endTime" text,breaks jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN

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
  SELECT s.id,s."officeId" FROM public."ShiftSchedule" s WHERE s."tenantId"=t AND s."isDefault"
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
  SELECT staff.id,d.day::date AS day,w.office,COALESCE(a."scheduleId",(SELECT def.id FROM default_schedule def WHERE def."officeId"=w.office)) AS schedule
  FROM staff CROSS JOIN generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
  CROSS JOIN LATERAL (SELECT app.workplace_on_day(t,staff.id,d.day::date) office) w
  LEFT JOIN LATERAL (SELECT x."scheduleId" FROM assignments x JOIN public."ShiftSchedule" source ON source.id=x."scheduleId" AND source."officeId"=w.office WHERE x."staffProfileId"=staff.id AND x."startDate"<=d.day::date AND (x."endDate" IS NULL OR x."endDate">=d.day::date) ORDER BY x."startDate" DESC,x.id DESC LIMIT 1) a ON true
 )
 SELECT req.id,req.day,req.office,template.id,template.name,template."startTime",template."endTime",COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',pause."startTime",'endTime',pause."endTime") ORDER BY pause."sortOrder",pause.id) FROM public."ShiftTemplateBreak" pause WHERE pause."templateId"=template.id),'[]'::jsonb)
 FROM requested req JOIN rotated r ON r.id=req.schedule AND r.day=req.day AND r.working
 JOIN blocks b ON b."scheduleId"=r.id AND b.cycle>0 AND mod(r.position,b.cycle)>=b.through-b."repeatDays" AND mod(r.position,b.cycle)<b.through
 JOIN public."ShiftTemplate" template ON template.id=b."templateId" AND template."tenantId"=t
 ORDER BY req.id,req.day;
END $$;
REVOKE ALL ON FUNCTION app.standard_day_sources(text,text[],date,date) FROM PUBLIC;
CREATE OR REPLACE FUNCTION app.standard_working_time(t text,profiles text[],first_day date,last_day date)
RETURNS TABLE("staffProfileId" text,date date,"startTime" text,"endTime" text,breaks jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 PERFORM app.require_working_time_access(t);
 RETURN QUERY SELECT s."staffProfileId",s.date,s."startTime",s."endTime",s.breaks FROM app.standard_day_sources(t,profiles,first_day,last_day) s;
END $$;

CREATE FUNCTION app.roster_history_readable(t text,staff text,o text,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.workforce_capability(t,'shiftRoster.read') AND (EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'')) OR app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),'')) OR EXISTS(SELECT 1 FROM public."StaffRosterLeaveSnapshot" s WHERE s."historyId"=k AND s."tenantId"=t AND app.leave_readable(t,s."officeId",staff)))
$$;
CREATE POLICY history_office_read ON "StaffRosterHistoryDay" AS RESTRICTIVE FOR SELECT USING(current_setting('app.rls_bypass',true)='on' OR app.roster_history_readable("tenantId","staffProfileId","officeId",id));
CREATE POLICY history_owner_insert ON "StaffRosterHistoryDay" AS RESTRICTIVE FOR INSERT WITH CHECK(current_setting('app.rls_bypass',true)='on');
CREATE POLICY history_owner_update ON "StaffRosterHistoryDay" AS RESTRICTIVE FOR UPDATE USING(current_setting('app.rls_bypass',true)='on');
CREATE POLICY history_owner_delete ON "StaffRosterHistoryDay" AS RESTRICTIVE FOR DELETE USING(current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION app.history_office_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE t text;
BEGIN
 SELECT u."tenantId" INTO t FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=NEW."staffProfileId";
 IF NEW."tenantId" IS NULL THEN NEW."tenantId":=t; END IF;
 IF NEW."officeId" IS NULL THEN NEW."officeId":=app.workplace_on_day(t,NEW."staffProfileId",NEW.date); END IF;
 IF NEW."tenantId" IS DISTINCT FROM t OR (TG_OP='UPDATE' AND (NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."officeId" IS DISTINCT FROM OLD."officeId")) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.history_office_owner() FROM PUBLIC;
CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE ON "StaffRosterHistoryDay" FOR EACH ROW EXECUTE FUNCTION app.history_office_owner();

CREATE FUNCTION app.history_flexible_slots(staff text,d date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE key_day public."Weekday":=(ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])[extract(dow FROM d)::integer+1]::public."Weekday"; day_id text; is_off boolean; slots jsonb; pattern public."StaffFlexiblePattern"%ROWTYPE; idx integer;
BEGIN
 SELECT day.id,day."isOff" INTO day_id,is_off FROM public."StaffFlexibleWeekDay" day JOIN public."StaffFlexibleWeekPlan" plan ON plan.id=day."planId" WHERE plan."staffProfileId"=staff AND plan."weekStartDate"=date_trunc('week',d::timestamp)::date AND day.day=key_day;
 IF is_off THEN RETURN '[]'::jsonb; END IF;
 SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks',COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',b."startTime",'endTime',b."endTime")) FROM public."StaffFlexibleWeekBreak" b WHERE b."slotId"=s.id),'[]'::jsonb)) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexibleWeekSlot" s WHERE s."dayId"=day_id;
 IF jsonb_array_length(slots)>0 THEN RETURN slots; END IF;
 SELECT * INTO pattern FROM public."StaffFlexiblePattern" p WHERE p."staffProfileId"=staff AND p."isActive" AND p."validFrom"<=d AND (p."validTo" IS NULL OR p."validTo">=d) ORDER BY p."validFrom" DESC,p."createdAt" DESC,p.id DESC LIMIT 1;
 IF pattern.id IS NOT NULL THEN
  idx:=((d-pattern."validFrom")/7)%pattern."cycleLengthWeeks"+1;
  SELECT day.id,day."isOff" INTO day_id,is_off FROM public."StaffFlexiblePatternDay" day JOIN public."StaffFlexiblePatternWeek" week ON week.id=day."weekId" WHERE week."patternId"=pattern.id AND week."weekIndex"=idx AND day.day=key_day;
  IF is_off THEN RETURN '[]'::jsonb; END IF;
  SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks',COALESCE((SELECT jsonb_agg(jsonb_build_object('startTime',b."startTime",'endTime',b."endTime")) FROM public."StaffFlexiblePatternBreak" b WHERE b."slotId"=s.id),'[]'::jsonb)) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexiblePatternSlot" s WHERE s."dayId"=day_id;
  IF jsonb_array_length(slots)>0 THEN RETURN slots; END IF;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks','[]'::jsonb) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexibleAvailability" s WHERE s."staffProfileId"=staff AND s.date=d;
 RETURN COALESCE(slots,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION app.history_flexible_slots(text,date) FROM PUBLIC;
CREATE FUNCTION app.work_minutes(slots jsonb) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE slot jsonb; pause jsonb; cursor integer; finish integer; first_minute integer; total integer:=0;
BEGIN
 FOR slot IN SELECT * FROM jsonb_array_elements(slots) LOOP
  cursor:=split_part(slot->>'startTime',':',1)::integer*60+split_part(slot->>'startTime',':',2)::integer;
  finish:=split_part(slot->>'endTime',':',1)::integer*60+split_part(slot->>'endTime',':',2)::integer;
  FOR pause IN SELECT * FROM jsonb_array_elements(COALESCE(slot->'breaks','[]'::jsonb)) b ORDER BY b->>'startTime' LOOP
   first_minute:=greatest(cursor,least(finish,split_part(pause->>'startTime',':',1)::integer*60+split_part(pause->>'startTime',':',2)::integer));
   total:=total+greatest(first_minute-cursor,0);
   cursor:=greatest(cursor,least(finish,split_part(pause->>'endTime',':',1)::integer*60+split_part(pause->>'endTime',':',2)::integer));
  END LOOP;
  total:=total+greatest(finish-cursor,0);
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION app.work_minutes(jsonb) FROM PUBLIC;

CREATE FUNCTION app.sync_roster_history(t text,profiles text[],first_day date,last_day date,replace_existing boolean) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
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
   SELECT * INTO overriding FROM public."StaffShiftOverride" x WHERE x."staffProfileId"=staff.id AND x.date=d;
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

CREATE FUNCTION app.capture_schedule_history(t text,k text) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE schedule public."ShiftSchedule"%ROWTYPE; person record; first_day date; last_day date; cursor_day date; n integer:=0;
BEGIN
 SELECT * INTO schedule FROM public."ShiftSchedule" WHERE "tenantId"=t AND id=k;
 IF NOT FOUND THEN RETURN 0; END IF;
 IF NOT COALESCE(app.workforce_capability(t,'shiftTemplates.edit'),false) AND NOT (app.schedule_readable(t,k) AND (app.workforce_capability(t,'shiftSchedules.create') OR app.workforce_capability(t,'shiftSchedules.edit') OR app.workforce_capability(t,'shiftSchedules.archive'))) THEN RAISE EXCEPTION 'Roster history access is not permitted' USING ERRCODE='42501'; END IF;
 last_day:=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),now())::date-1;
 FOR person IN SELECT p.id,CASE WHEN schedule."isDefault" THEN schedule."startDate" ELSE (SELECT min(a."startDate") FROM public."StaffScheduleAssignment" a WHERE a."staffProfileId"=p.id AND a."scheduleId"=k) END first_date FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE u."tenantId"=t AND ((schedule."isDefault" AND EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" w WHERE w."tenantId"=t AND w."staffProfileId"=p.id AND w."officeId"=schedule."officeId" AND w."canceledAt" IS NULL)) OR EXISTS(SELECT 1 FROM public."StaffScheduleAssignment" a WHERE a."staffProfileId"=p.id AND a."scheduleId"=k)) LOOP
  first_day:=person.first_date;cursor_day:=first_day;
  WHILE cursor_day<=last_day LOOP n:=n+app.sync_roster_history(t,ARRAY[person.id],cursor_day,least(cursor_day+365,last_day),false);cursor_day:=cursor_day+366;END LOOP;
 END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION app.capture_template_history(t text,k text) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE schedule record; overriding record; last_day date; n integer:=0;
BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftTemplates.edit'),false) OR NOT EXISTS(SELECT 1 FROM public."ShiftTemplate" WHERE "tenantId"=t AND id=k) THEN RAISE EXCEPTION 'Roster history access is not permitted' USING ERRCODE='42501'; END IF;
 FOR schedule IN SELECT DISTINCT s.id FROM public."ShiftSchedule" s JOIN public."ShiftScheduleBlock" b ON b."scheduleId"=s.id WHERE s."tenantId"=t AND b."templateId"=k LOOP n:=n+app.capture_schedule_history(t,schedule.id);END LOOP;
 last_day:=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),now())::date-1;
 FOR overriding IN SELECT x."staffProfileId",x.date FROM public."StaffShiftOverride" x JOIN public."StaffProfile" p ON p.id=x."staffProfileId" JOIN public."User" u ON u.id=p."userId" WHERE u."tenantId"=t AND x."templateId"=k AND x.date<=last_day LOOP n:=n+app.sync_roster_history(t,ARRAY[overriding."staffProfileId"],overriding.date,overriding.date,false); END LOOP;
 RETURN n;
END $$;
CREATE FUNCTION app.schedule_office_label(t text,k text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('id',o.id,'name',o.name,'companyName',c.name,'active',NOT(o.archived OR c.archived)) FROM public."ShiftSchedule" s JOIN public."BusinessOffice" o ON o."tenantId"=s."tenantId" AND o.id=s."officeId" JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" WHERE s."tenantId"=t AND s.id=k AND app.schedule_readable(t,k)
$$;
CREATE FUNCTION app.standard_default_choices(t text,profiles text[],first_day date,last_day date) RETURNS TABLE("staffId" text,date date,"scheduleId" text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftSchedules.read'),false) THEN RAISE EXCEPTION 'Schedule office access is not permitted' USING ERRCODE='42501'; END IF;
 IF profiles IS NULL OR cardinality(profiles)>200 OR array_position(profiles,NULL) IS NOT NULL OR first_day IS NULL OR last_day IS NULL OR NOT isfinite(first_day) OR NOT isfinite(last_day) OR first_day>last_day OR last_day-first_day>365 THEN RAISE EXCEPTION 'Invalid working-time selection' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT p."userId",d.day::date,s.id FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" AND u."tenantId"=t CROSS JOIN generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day) JOIN public."ShiftSchedule" s ON s."tenantId"=t AND s."isDefault" AND s."officeId"=app.workplace_on_day(t,p.id,d.day::date) WHERE p.id=ANY(profiles) AND p."schedulingMode"='STANDARD' AND app.schedule_readable(t,s.id);
END $$;
-- Normalize historical audit ownership once; no runtime initial-office fallback.
UPDATE "AuditLog" a SET metadata=COALESCE(a.metadata,'{}'::jsonb)||jsonb_build_object('officeId',o.id) FROM "BusinessOffice" o WHERE a."entityType"='shiftSchedules' AND a."tenantId"=o."tenantId" AND o."isInitial" AND NOT COALESCE(a.metadata,'{}'::jsonb)?'officeId';
CREATE FUNCTION app.schedule_audit_readable(t text,m jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.workforce_capability(t,'shiftSchedules.read') AND app.business_office_access(t,m->>'officeId',nullif(current_setting('app.actor_id',true),''))
$$;
CREATE POLICY schedule_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING("entityType" IS DISTINCT FROM 'shiftSchedules' OR app.schedule_audit_readable("tenantId",metadata));
CREATE FUNCTION app.template_in_use(t text,k text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftTemplates.archive'),false) THEN RAISE EXCEPTION 'Schedule office access is not permitted' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(SELECT 1 FROM public."ShiftScheduleBlock" b JOIN public."ShiftSchedule" s ON s.id=b."scheduleId" WHERE s."tenantId"=t AND b."templateId"=k) OR EXISTS(SELECT 1 FROM public."StaffShiftOverride" x JOIN public."StaffProfile" p ON p.id=x."staffProfileId" JOIN public."User" u ON u.id=p."userId" WHERE u."tenantId"=t AND x."templateId"=k) OR EXISTS(SELECT 1 FROM public."StaffRosterHistoryDay" h WHERE h."tenantId"=t AND h."templateId"=k);
END $$;
COMMIT;
