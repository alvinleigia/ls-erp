BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Flexible plan migration requires BYPASSRLS'; END IF;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['StaffFlexibleWeekPlan','StaffFlexiblePattern'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN "tenantId" text,ADD COLUMN "officeId" text',tbl);
  EXECUTE format('UPDATE %I r SET "tenantId"=u."tenantId","officeId"=o.id FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE p.id=r."staffProfileId"',tbl);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN "tenantId" SET NOT NULL,ALTER COLUMN "officeId" SET NOT NULL,ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id()',tbl);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED',tbl,tbl||'_tenantId_officeId_fkey');
  EXECUTE format('CREATE INDEX %I ON %I("tenantId","officeId")',tbl||'_tenantId_officeId_idx',tbl);
 END LOOP;
END $$;

CREATE FUNCTION app.flexible_readable(t text,o text,family text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT family IN ('WEEK','PATTERN') AND app.workforce_capability(t,CASE family WHEN 'WEEK' THEN 'shiftRoster.read' ELSE 'shiftPlans.read' END) AND app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))
$$;
-- Private ancestry lookup. It cannot be used as a source-record directory.
CREATE FUNCTION app.flexible_root(tbl text,k text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 CASE tbl
 WHEN 'StaffFlexibleWeekPlan' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','WEEK') FROM public."StaffFlexibleWeekPlan" p WHERE p.id=k);
 WHEN 'StaffFlexibleWeekDay' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','WEEK') FROM public."StaffFlexibleWeekDay" d JOIN public."StaffFlexibleWeekPlan" p ON p.id=d."planId" WHERE d.id=k);
 WHEN 'StaffFlexibleWeekSlot' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','WEEK') FROM public."StaffFlexibleWeekSlot" s JOIN public."StaffFlexibleWeekDay" d ON d.id=s."dayId" JOIN public."StaffFlexibleWeekPlan" p ON p.id=d."planId" WHERE s.id=k);
 WHEN 'StaffFlexiblePattern' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','PATTERN') FROM public."StaffFlexiblePattern" p WHERE p.id=k);
 WHEN 'StaffFlexiblePatternWeek' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','PATTERN') FROM public."StaffFlexiblePatternWeek" w JOIN public."StaffFlexiblePattern" p ON p.id=w."patternId" WHERE w.id=k);
 WHEN 'StaffFlexiblePatternDay' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','PATTERN') FROM public."StaffFlexiblePatternDay" d JOIN public."StaffFlexiblePatternWeek" w ON w.id=d."weekId" JOIN public."StaffFlexiblePattern" p ON p.id=w."patternId" WHERE d.id=k);
 WHEN 'StaffFlexiblePatternSlot' THEN RETURN (SELECT to_jsonb(p)||jsonb_build_object('family','PATTERN') FROM public."StaffFlexiblePatternSlot" s JOIN public."StaffFlexiblePatternDay" d ON d.id=s."dayId" JOIN public."StaffFlexiblePatternWeek" w ON w.id=d."weekId" JOIN public."StaffFlexiblePattern" p ON p.id=w."patternId" WHERE s.id=k);
 ELSE RETURN NULL; END CASE;
END $$;
REVOKE ALL ON FUNCTION app.flexible_root(text,text) FROM PUBLIC;
CREATE FUNCTION app.flexible_child_readable(tbl text,k text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r jsonb:=app.flexible_root(tbl,k); BEGIN RETURN COALESCE(app.flexible_readable(r->>'tenantId',r->>'officeId',r->>'family'),false); END $$;
-- Avoid recursive parent RLS expansion at each nested level. Tenant and office
-- remain separate policies; only a bounded ancestry lookup bypasses source RLS.
CREATE FUNCTION app.flexible_child_in_tenant(tbl text,k text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r jsonb:=app.flexible_root(tbl,k); BEGIN RETURN COALESCE(r->>'tenantId'=nullif(current_setting('app.tenant_id',true),''),false); END $$;

CREATE FUNCTION app.flexible_coverage(t text,o text,staff text,first_day date,last_day date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT first_day IS NOT NULL AND isfinite(first_day) AND (last_day IS NULL OR (isfinite(last_day) AND last_day>=first_day))
 AND EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t AND u.role='STAFF' AND u.status='ACTIVE' AND p."schedulingMode"='FLEXIBLE' AND app.office_assignment_allowed(t,o,u.id))
 AND EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" w WHERE w."tenantId"=t AND w."staffProfileId"=staff AND w."officeId"=o AND w."canceledAt" IS NULL AND (w."startDate" IS NULL OR w."startDate"<=first_day) AND (w."endDate" IS NULL OR (last_day IS NOT NULL AND w."endDate">=last_day)))
$$;
REVOKE ALL ON FUNCTION app.flexible_coverage(text,text,text,date,date) FROM PUBLIC;
CREATE FUNCTION app.flexible_creation_office(t text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o text:=app.creation_office_id(); u text:=nullif(current_setting('app.actor_id',true),''); expected_version text:=nullif(current_setting('app.office_version',true),''); BEGIN
 IF NOT COALESCE(app.workforce_capability(t,'shiftPlans.read') OR app.workforce_capability(t,'shiftRoster.read'),false) OR o IS NULL OR expected_version IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501'; END IF;
 IF NOT app.business_office_allowed(t,o,u) THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=u AND p."creationOfficeId"=o AND p.version::text=expected_version) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001'; END IF;
 RETURN o;
END $$;
CREATE FUNCTION app.flexible_target_allowed(t text,o text,staff text,first_day date,last_day date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT (app.flexible_readable(t,o,'PATTERN') OR app.flexible_readable(t,o,'WEEK')) AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')) AND app.flexible_coverage(t,o,staff,first_day,last_day)
$$;

CREATE FUNCTION app.flexible_office_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE payload jsonb; prior jsonb; r jsonb; family text; resource text; t text; o text; staff text; parent_tbl text; parent_key text; op text:=nullif(current_setting('app.workforce_operation',true),''); caller text:=nullif(current_setting('app.actor_id',true),''); first_day date; last_day date; is_root boolean; narrowing boolean:=false; archive_only boolean:=false; permission text;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN payload:=to_jsonb(OLD); ELSE payload:=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' THEN prior:=to_jsonb(OLD); END IF;
 is_root:=TG_TABLE_NAME IN ('StaffFlexibleWeekPlan','StaffFlexiblePattern');
 IF is_root THEN r:=payload||jsonb_build_object('family',CASE TG_TABLE_NAME WHEN 'StaffFlexibleWeekPlan' THEN 'WEEK' ELSE 'PATTERN' END);
 ELSE
  CASE TG_TABLE_NAME
  WHEN 'StaffFlexibleWeekDay' THEN parent_tbl:='StaffFlexibleWeekPlan';parent_key:='planId';
  WHEN 'StaffFlexibleWeekSlot' THEN parent_tbl:='StaffFlexibleWeekDay';parent_key:='dayId';
  WHEN 'StaffFlexibleWeekBreak' THEN parent_tbl:='StaffFlexibleWeekSlot';parent_key:='slotId';
  WHEN 'StaffFlexiblePatternWeek' THEN parent_tbl:='StaffFlexiblePattern';parent_key:='patternId';
  WHEN 'StaffFlexiblePatternDay' THEN parent_tbl:='StaffFlexiblePatternWeek';parent_key:='weekId';
  WHEN 'StaffFlexiblePatternSlot' THEN parent_tbl:='StaffFlexiblePatternDay';parent_key:='dayId';
  WHEN 'StaffFlexiblePatternBreak' THEN parent_tbl:='StaffFlexiblePatternSlot';parent_key:='slotId';
  ELSE RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END CASE;
  r:=app.flexible_root(parent_tbl,payload->>parent_key);
  IF r IS NULL AND TG_OP='DELETE' THEN RETURN OLD; END IF; -- Authorized parent cascade.
 END IF;
 family:=r->>'family';t:=r->>'tenantId';o:=r->>'officeId';staff:=r->>'staffProfileId';resource:=CASE family WHEN 'WEEK' THEN 'shiftRoster' ELSE 'shiftPlans' END;
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 IF op IS NULL OR split_part(op,'.',1) IS DISTINCT FROM resource OR t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR NOT COALESCE(app.flexible_readable(t,o,family) AND app.business_office_allowed(t,o,caller),false) THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF payload->>'id' IS DISTINCT FROM prior->>'id' OR (is_root AND (payload->>'tenantId' IS DISTINCT FROM prior->>'tenantId' OR payload->>'officeId' IS DISTINCT FROM prior->>'officeId' OR payload->>'staffProfileId' IS DISTINCT FROM prior->>'staffProfileId' OR (family='WEEK' AND payload->>'weekStartDate' IS DISTINCT FROM prior->>'weekStartDate'))) OR (NOT is_root AND payload->>parent_key IS DISTINCT FROM prior->>parent_key) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514'; END IF;
  archive_only:=is_root AND family='PATTERN' AND (payload-'updatedAt'-'isActive')=(prior-'updatedAt'-'isActive') AND NOT (payload->>'isActive')::boolean;
 END IF;
 permission:=CASE WHEN NOT is_root THEN op WHEN family='WEEK' THEN resource||CASE WHEN TG_OP='DELETE' THEN '.archive' ELSE '.edit' END WHEN TG_OP='INSERT' THEN 'shiftPlans.create' WHEN TG_OP='DELETE' OR archive_only THEN 'shiftPlans.archive' ELSE 'shiftPlans.edit' END;
 IF NOT is_root AND op NOT IN (resource||'.create',resource||'.edit',resource||'.archive') THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE(app.workforce_capability(t,permission),false) THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 IF NOT is_root AND (op=resource||'.archive' OR (op=resource||'.create' AND (TG_OP<>'INSERT' OR current_setting('app.new_flexible_plan',true) IS DISTINCT FROM family||':'||(r->>'id')))) THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 IF is_root THEN
  IF TG_OP='INSERT' THEN
   IF o IS DISTINCT FROM app.flexible_creation_office(t) THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501'; END IF;
   PERFORM set_config('app.new_flexible_plan',family||':'||(payload->>'id'),true);
   IF family='WEEK' AND EXISTS(SELECT 1 FROM public."StaffFlexibleWeekPlan" w WHERE w."staffProfileId"=staff AND w."weekStartDate"=(payload->>'weekStartDate')::date) THEN RAISE EXCEPTION 'A flexible plan already exists outside this operation' USING ERRCODE='40001'; END IF;
  END IF;
  IF family='WEEK' THEN first_day:=(payload->>'weekStartDate')::date;last_day:=first_day+6;
  ELSE first_day:=(payload->>'validFrom')::date;last_day:=(payload->>'validTo')::date;
   IF TG_OP='UPDATE' AND payload->>'isActive' IS DISTINCT FROM prior->>'isActive' THEN
    IF NOT app.workforce_capability(t,'shiftPlans.archive') THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
   END IF;
   IF TG_OP='UPDATE' THEN narrowing:=first_day=(prior->>'validFrom')::date AND ((last_day IS NOT DISTINCT FROM (prior->>'validTo')::date) OR (last_day IS NOT NULL AND ((prior->>'validTo') IS NULL OR last_day<=(prior->>'validTo')::date))) AND (NOT (payload->>'isActive')::boolean OR (prior->>'isActive')::boolean); END IF;
  END IF;
  IF TG_OP<>'DELETE' AND NOT (family='WEEK' AND TG_OP='UPDATE') AND NOT narrowing AND NOT COALESCE(app.flexible_coverage(t,o,staff,first_day,last_day),false) THEN RAISE EXCEPTION 'Choose staff with workplace coverage for the entire plan' USING ERRCODE='23514'; END IF;
  IF family='PATTERN' AND TG_OP<>'DELETE' AND (payload->>'isActive')::boolean AND EXISTS(SELECT 1 FROM public."StaffFlexiblePattern" p WHERE p."staffProfileId"=staff AND p.id<>payload->>'id' AND p."isActive" AND (last_day IS NULL OR p."validFrom"<=last_day) AND (p."validTo" IS NULL OR p."validTo">=first_day)) THEN RAISE EXCEPTION 'Resolve overlapping flexible plans before saving' USING ERRCODE='40001'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION app.flexible_office_owner() FROM PUBLIC;

DO $$ DECLARE tbl text; parent_tbl text; parent_key text; family text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['StaffFlexibleWeekPlan','StaffFlexibleWeekDay','StaffFlexibleWeekSlot','StaffFlexibleWeekBreak','StaffFlexiblePattern','StaffFlexiblePatternWeek','StaffFlexiblePatternDay','StaffFlexiblePatternSlot','StaffFlexiblePatternBreak'] LOOP
  IF tbl IN ('StaffFlexibleWeekPlan','StaffFlexiblePattern') THEN
   family:=CASE tbl WHEN 'StaffFlexibleWeekPlan' THEN 'WEEK' ELSE 'PATTERN' END;
   EXECUTE format('CREATE POLICY flexible_office ON %I AS RESTRICTIVE FOR ALL USING(current_setting(''app.rls_bypass'',true)=''on'' OR app.flexible_readable("tenantId","officeId",%L)) WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'' OR app.flexible_readable("tenantId","officeId",%L))',tbl,family,family);
  ELSE
   CASE tbl WHEN 'StaffFlexibleWeekDay' THEN parent_tbl:='StaffFlexibleWeekPlan';parent_key:='planId'; WHEN 'StaffFlexibleWeekSlot' THEN parent_tbl:='StaffFlexibleWeekDay';parent_key:='dayId'; WHEN 'StaffFlexibleWeekBreak' THEN parent_tbl:='StaffFlexibleWeekSlot';parent_key:='slotId'; WHEN 'StaffFlexiblePatternWeek' THEN parent_tbl:='StaffFlexiblePattern';parent_key:='patternId'; WHEN 'StaffFlexiblePatternDay' THEN parent_tbl:='StaffFlexiblePatternWeek';parent_key:='weekId'; WHEN 'StaffFlexiblePatternSlot' THEN parent_tbl:='StaffFlexiblePatternDay';parent_key:='dayId'; ELSE parent_tbl:='StaffFlexiblePatternSlot';parent_key:='slotId'; END CASE;
   EXECUTE format('ALTER POLICY tenant_isolation ON %I USING(current_setting(''app.rls_bypass'',true)=''on'' OR app.flexible_child_in_tenant(%L,%I)) WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'' OR app.flexible_child_in_tenant(%L,%I))',tbl,parent_tbl,parent_key,parent_tbl,parent_key);
   EXECUTE format('CREATE POLICY flexible_office ON %I AS RESTRICTIVE FOR ALL USING(current_setting(''app.rls_bypass'',true)=''on'' OR app.flexible_child_readable(%L,%I)) WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'' OR app.flexible_child_readable(%L,%I))',tbl,parent_tbl,parent_key,parent_tbl,parent_key);
  END IF;
  EXECUTE format('CREATE TRIGGER office_ownership BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.flexible_office_owner()',tbl);
 END LOOP;
END $$;

UPDATE "AuditLog" a SET metadata=COALESCE(a.metadata,'{}'::jsonb)||jsonb_build_object('officeId',o.id,'officeFamily','flexiblePlans') FROM "BusinessOffice" o WHERE a."tenantId"=o."tenantId" AND o."isInitial" AND (a."entityType"='shiftPlans' OR (a."entityType"='shiftRoster' AND (a.before?'weekStartDate' OR a.after?'weekStartDate')));
CREATE FUNCTION app.flexible_audit_readable(t text,resource text,m jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT resource IN ('shiftPlans','shiftRoster') AND app.workforce_capability(t,resource||'.read') AND app.business_office_access(t,m->>'officeId',nullif(current_setting('app.actor_id',true),''))
$$;
CREATE POLICY flexible_office_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING(NOT COALESCE(("entityType"='shiftPlans' OR ("entityType"='shiftRoster' AND metadata->>'officeFamily'='flexiblePlans')),false) OR app.flexible_audit_readable("tenantId","entityType",metadata));
CREATE FUNCTION app.flexible_office_label(t text,family text,k text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r jsonb:=app.flexible_root(CASE family WHEN 'WEEK' THEN 'StaffFlexibleWeekPlan' WHEN 'PATTERN' THEN 'StaffFlexiblePattern' ELSE '' END,k); BEGIN
 IF r->>'tenantId' IS DISTINCT FROM t OR NOT COALESCE(app.flexible_readable(t,r->>'officeId',family),false) THEN RETURN NULL; END IF;
 RETURN (SELECT jsonb_build_object('id',o.id,'name',o.name,'companyName',c.name,'active',NOT(o.archived OR c.archived)) FROM public."BusinessOffice" o JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" WHERE o."tenantId"=t AND o.id=r->>'officeId');
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
 SELECT jsonb_agg(jsonb_build_object('startTime',s."startTime",'endTime',s."endTime",'breaks','[]'::jsonb) ORDER BY s."startTime",s.id) INTO slots FROM public."StaffFlexibleAvailability" s WHERE s."staffProfileId"=staff AND s.date=d;
 RETURN COALESCE(slots,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION app.history_flexible_slots(text,date) FROM PUBLIC;
CREATE FUNCTION app.check_flexible_overlap(t text,o text,staff text,first_day date,last_day date,excluding text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF NOT COALESCE(app.flexible_readable(t,o,'PATTERN') AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public."StaffFlexiblePattern" p WHERE p."tenantId"=t AND p."staffProfileId"=staff AND p."officeId"<>o AND p."isActive" AND p.id IS DISTINCT FROM excluding AND (last_day IS NULL OR p."validFrom"<=last_day) AND (p."validTo" IS NULL OR p."validTo">=first_day)) THEN RAISE EXCEPTION 'Resolve overlapping flexible plans before saving' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION app.scheduling_mode_plan_conflict(t text,staff text,target text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE today date; BEGIN
 IF target NOT IN ('STANDARD','FLEXIBLE') OR NOT COALESCE(app.workforce_capability(t,'shiftRoster.edit'),false) OR NOT EXISTS(SELECT 1 FROM public."User" u WHERE u."tenantId"=t AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.role='ADMIN') OR NOT EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t) THEN RAISE EXCEPTION 'Flexible plan office access is not permitted' USING ERRCODE='42501'; END IF;
 today:=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),now())::date;
 IF target='FLEXIBLE' THEN RETURN EXISTS(SELECT 1 FROM public."StaffScheduleAssignment" a WHERE a."staffProfileId"=staff AND (a."endDate" IS NULL OR a."endDate">=today)); END IF;
 RETURN EXISTS(SELECT 1 FROM public."StaffFlexiblePattern" p WHERE p."tenantId"=t AND p."staffProfileId"=staff AND p."isActive" AND (p."validTo" IS NULL OR p."validTo">=today))
 OR EXISTS(SELECT 1 FROM public."StaffFlexibleWeekPlan" p WHERE p."tenantId"=t AND p."staffProfileId"=staff AND p."weekStartDate">=date_trunc('week',today::timestamp)::date)
 OR EXISTS(SELECT 1 FROM public."StaffFlexibleAvailability" p WHERE p."staffProfileId"=staff AND p.date>=today);
END $$;
COMMIT;
