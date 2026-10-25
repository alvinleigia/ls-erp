BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Workplace migration requires BYPASSRLS'; END IF;
 IF EXISTS(SELECT 1 FROM "StaffProfile" s JOIN "User" u ON u.id=s."userId" WHERE u."tenantId" IS NULL OR NOT EXISTS(SELECT 1 FROM "BusinessOffice" o WHERE o."tenantId"=u."tenantId" AND o."isInitial")) THEN RAISE EXCEPTION 'Staff workplace tenant or initial office is missing'; END IF;
END $$;

CREATE TABLE "StaffWorkplacePolicy" (
 "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "staffProfileId" text NOT NULL UNIQUE REFERENCES "StaffProfile"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),"updatedAt" timestamp(3) NOT NULL,
 PRIMARY KEY("tenantId","staffProfileId")
);
CREATE TABLE "StaffWorkplaceAssignment" (
 id text PRIMARY KEY,"tenantId" text NOT NULL,"staffProfileId" text NOT NULL,"officeId" text NOT NULL,
 "startDate" date,"endDate" date,"canceledAt" timestamp(3),"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamp(3) NOT NULL,
 FOREIGN KEY("tenantId","staffProfileId") REFERENCES "StaffWorkplacePolicy"("tenantId","staffProfileId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "StaffWorkplaceAssignment_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
 CHECK("startDate" IS NULL OR "endDate" IS NULL OR "startDate"<="endDate")
);
CREATE INDEX "StaffWorkplaceAssignment_tenantId_officeId_idx" ON "StaffWorkplaceAssignment"("tenantId","officeId");
CREATE INDEX "StaffWorkplaceAssignment_staffProfileId_startDate_idx" ON "StaffWorkplaceAssignment"("staffProfileId","startDate");
CREATE UNIQUE INDEX "StaffWorkplaceAssignment_open" ON "StaffWorkplaceAssignment"("staffProfileId") WHERE "endDate" IS NULL AND "canceledAt" IS NULL;
-- One-time normalization. Never derive a new employee's placement from a CRM preference.
INSERT INTO "StaffWorkplacePolicy" SELECT u."tenantId",s.id,1,timezone('UTC',clock_timestamp()) FROM "StaffProfile" s JOIN "User" u ON u.id=s."userId";
INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT gen_random_uuid()::text,p."tenantId",p."staffProfileId",o.id,timezone('UTC',clock_timestamp()) FROM "StaffWorkplacePolicy" p JOIN "BusinessOffice" o ON o."tenantId"=p."tenantId" AND o."isInitial";

CREATE FUNCTION app.workplace_capability(t text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND p IN ('shiftRoster.read','shiftRoster.edit','shiftRoster.archive') AND EXISTS(
 SELECT 1 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" JOIN public."TenantModule" m ON m."tenantId"=tenant.id AND m.key='shifts' AND m.allowed AND m.enabled
 WHERE tenant.id=t AND tenant.status='ACTIVE' AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id AND policy.rules->>p='ALL' AND policy.rules->>'shiftRoster.read'='ALL'
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND 'shiftRoster.read'=ANY(r.permissions)))))
$$;
REVOKE ALL ON FUNCTION app.workplace_capability(text,text) FROM PUBLIC;
CREATE FUNCTION app.workplace_readable(t text,staff text,o text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.workplace_capability(t,'shiftRoster.read') AND EXISTS(SELECT 1 FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE s.id=staff AND u."tenantId"=t AND (u.id=nullif(current_setting('app.actor_id',true),'') OR app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))))
$$;
CREATE FUNCTION app.workplace_target(t text,target text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT s.id FROM public."StaffProfile" s JOIN public."User" u ON u.id=s."userId" WHERE u."tenantId"=t AND u.id=target AND u.role IN ('ADMIN','MANAGER','STAFF') AND app.workplace_capability(t,'shiftRoster.read') AND (
 u.id=nullif(current_setting('app.actor_id',true),'') OR EXISTS(SELECT 1 FROM public."User" caller WHERE caller.id=nullif(current_setting('app.actor_id',true),'') AND caller."tenantId"=t AND caller.role='ADMIN')
 OR EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" a WHERE a."tenantId"=t AND a."staffProfileId"=s.id AND app.workplace_readable(t,s.id,a."officeId"))
 OR EXISTS(SELECT 1 FROM public."BusinessOffice" o WHERE o."tenantId"=t AND app.office_assignment_allowed(t,o.id,u.id)))
$$;
REVOKE ALL ON FUNCTION app.workplace_target(text,text) FROM PUBLIC;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "StaffWorkplacePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffWorkplacePolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "StaffWorkplaceAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffWorkplaceAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY workplace_read ON "StaffWorkplaceAssignment" FOR SELECT USING(app.workplace_readable("tenantId","staffProfileId","officeId"));
-- Policy versions are read through the bounded target projection below.
GRANT SELECT ON "StaffWorkplaceAssignment","StaffWorkplacePolicy" TO PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON "StaffWorkplaceAssignment","StaffWorkplacePolicy" FROM PUBLIC;

CREATE FUNCTION app.staff_workplace_view(t text,target text,lim integer,off integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE staff text; result jsonb; latest public."StaffWorkplaceAssignment"%ROWTYPE; business_today date;
BEGIN
 IF NOT app.workplace_capability(t,'shiftRoster.read') THEN RAISE EXCEPTION 'Staff workplace access is not permitted' USING ERRCODE='42501'; END IF;
 staff:=app.workplace_target(t,target); IF staff IS NULL THEN RETURN NULL; END IF;
 IF lim IS NULL OR off IS NULL OR lim NOT BETWEEN 1 AND 100 OR off NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'Invalid workplace query'; END IF;
 SELECT timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),now())::date INTO business_today;
 SELECT * INTO latest FROM public."StaffWorkplaceAssignment" WHERE "tenantId"=t AND "staffProfileId"=staff AND "endDate" IS NULL AND "canceledAt" IS NULL;
 WITH visible AS (SELECT a.id,a."officeId",o.name AS "officeName",c.name AS "companyName",a."startDate",a."endDate",a."canceledAt" FROM public."StaffWorkplaceAssignment" a JOIN public."BusinessOffice" o ON o."tenantId"=a."tenantId" AND o.id=a."officeId" JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" WHERE a."tenantId"=t AND a."staffProfileId"=staff AND app.workplace_readable(t,staff,a."officeId"))
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "startDate" DESC NULLS LAST,id) FROM (SELECT * FROM visible ORDER BY "startDate" DESC NULLS LAST,id LIMIT lim OFFSET off) page),'[]'::jsonb),'total',(SELECT count(*) FROM visible),
 'current',(SELECT to_jsonb(v) FROM visible v WHERE "canceledAt" IS NULL AND ("startDate" IS NULL OR "startDate"<=business_today) AND ("endDate" IS NULL OR "endDate">=business_today) LIMIT 1),
 'latest',(SELECT to_jsonb(v) FROM visible v WHERE id=latest.id)) INTO result;
 RETURN result||jsonb_build_object('version',COALESCE((SELECT version FROM public."StaffWorkplacePolicy" WHERE "tenantId"=t AND "staffProfileId"=staff),0),'today',business_today,
 'canAssign',app.workplace_capability(t,'shiftRoster.edit') AND (latest.id IS NULL OR app.business_office_access(t,latest."officeId",nullif(current_setting('app.actor_id',true),''))) AND EXISTS(SELECT 1 FROM public."User" WHERE id=target AND "tenantId"=t AND status='ACTIVE'),
 'canCancel',COALESCE(app.workplace_capability(t,'shiftRoster.edit') AND app.workplace_capability(t,'shiftRoster.archive') AND latest."startDate">business_today AND app.business_office_access(t,latest."officeId",nullif(current_setting('app.actor_id',true),'')),false));
END $$;

CREATE FUNCTION app.staff_workplace_offices(t text,target text,q text,lim integer,off integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF NOT app.workplace_capability(t,'shiftRoster.edit') THEN RAISE EXCEPTION 'Staff workplace access is not permitted' USING ERRCODE='42501'; END IF;
 IF app.workplace_target(t,target) IS NULL THEN RETURN NULL; END IF;
 IF lim IS NULL OR off IS NULL OR q IS NULL OR lim NOT BETWEEN 1 AND 100 OR off NOT BETWEEN 0 AND 10000000 OR length(q)>160 THEN RAISE EXCEPTION 'Invalid workplace query'; END IF;
 RETURN (WITH choices AS (SELECT o.id,c.name||' / '||o.name AS name FROM public."BusinessOffice" o JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" JOIN public."User" u ON u.id=target AND u."tenantId"=t AND u.status='ACTIVE' WHERE o."tenantId"=t AND NOT o.archived AND NOT c.archived AND app.office_assignment_allowed(t,o.id,target) AND (q='' OR strpos(lower(o.name||' '||c.name||' '||o.code),lower(q))>0))
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY name,id) FROM (SELECT * FROM choices ORDER BY name,id LIMIT lim OFFSET off) page),'[]'::jsonb),'total',(SELECT count(*) FROM choices)));
END $$;

-- Only this writer changes placement windows. It serializes with every schedule,
-- booking and leave writer, then with membership/profile administration.
CREATE FUNCTION app.change_staff_workplace(t text,target text,expected integer,destination text,effective date,source text,cancel_id text,request_id text) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE staff text; caller text:=nullif(current_setting('app.actor_id',true),''); latest public."StaffWorkplaceAssignment"%ROWTYPE; previous public."StaffWorkplaceAssignment"%ROWTYPE; next_id text; v integer; business_today date; zone text; before_doc jsonb; after_doc jsonb; ids text[]; audit_event text;
BEGIN
 IF t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') THEN RAISE EXCEPTION 'Staff workplace access is not permitted' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 PERFORM id FROM public."Tenant" WHERE id=t FOR UPDATE;
 IF NOT app.workplace_capability(t,'shiftRoster.edit') OR (cancel_id IS NOT NULL AND NOT app.workplace_capability(t,'shiftRoster.archive')) THEN RAISE EXCEPTION 'Staff workplace access is not permitted' USING ERRCODE='42501'; END IF;
 staff:=app.workplace_target(t,target);
 IF staff IS NULL OR NOT EXISTS(SELECT 1 FROM public."User" WHERE id=target AND "tenantId"=t AND status='ACTIVE') THEN RAISE EXCEPTION 'Staff workplace target not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public."StaffWorkplacePolicy"("tenantId","staffProfileId","updatedAt") VALUES(t,staff,timezone('UTC',clock_timestamp())) ON CONFLICT DO NOTHING;
 SELECT version INTO v FROM public."StaffWorkplacePolicy" WHERE "tenantId"=t AND "staffProfileId"=staff FOR UPDATE;
 SELECT * INTO latest FROM public."StaffWorkplaceAssignment" WHERE "tenantId"=t AND "staffProfileId"=staff AND "endDate" IS NULL AND "canceledAt" IS NULL;
 IF expected IS NULL OR expected<0 OR expected<>v OR (cancel_id IS NULL AND source IS DISTINCT FROM latest.id) OR (cancel_id IS NOT NULL AND cancel_id IS DISTINCT FROM latest.id) THEN RAISE EXCEPTION 'Workplace record changed; refresh before saving' USING ERRCODE='40001'; END IF;
 IF latest.id IS NOT NULL AND NOT app.business_office_access(t,latest."officeId",caller) THEN RAISE EXCEPTION 'Staff workplace access is not permitted' USING ERRCODE='42501'; END IF;
 SELECT COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC') INTO zone;
 business_today:=timezone(zone,now())::date;
 IF cancel_id IS NOT NULL THEN
  IF destination IS NOT NULL OR effective IS NOT NULL OR source IS NOT NULL OR latest."startDate" IS NULL OR latest."startDate"<=business_today THEN RAISE EXCEPTION 'Only a future workplace transfer can be canceled' USING ERRCODE='22023'; END IF;
  effective:=latest."startDate";
  SELECT * INTO previous FROM public."StaffWorkplaceAssignment" WHERE "tenantId"=t AND "staffProfileId"=staff AND "canceledAt" IS NULL AND "endDate"=effective-1;
  IF previous.id IS NOT NULL AND (NOT app.business_office_allowed(t,previous."officeId",caller) OR NOT app.office_assignment_allowed(t,previous."officeId",target)) THEN RAISE EXCEPTION 'Choose an active office allowed for this employee' USING ERRCODE='42501'; END IF;
 ELSE
  IF effective IS NULL OR effective<business_today THEN RAISE EXCEPTION 'Effective date cannot be in the past' USING ERRCODE='22023'; END IF;
  IF latest."startDate" IS NOT NULL AND effective<=latest."startDate" THEN RAISE EXCEPTION 'Workplace date must follow its current start date' USING ERRCODE='22023'; END IF;
  IF latest."officeId"=destination THEN RAISE EXCEPTION 'Workplace already assigned to this office' USING ERRCODE='40001'; END IF;
  IF destination IS NULL OR NOT app.business_office_allowed(t,destination,caller) OR NOT app.office_assignment_allowed(t,destination,target) THEN RAISE EXCEPTION 'Choose an active office allowed for this employee' USING ERRCODE='42501'; END IF;
 END IF;
 -- Evaluate every source as the owner. Hidden work blocks a transfer without
 -- returning plan, appointment, customer or private leave information.
 IF EXISTS(SELECT 1 FROM public."StaffScheduleAssignment" WHERE "staffProfileId"=staff AND ("endDate" IS NULL OR "endDate">=effective))
 OR EXISTS(SELECT 1 FROM public."StaffFlexiblePattern" WHERE "staffProfileId"=staff AND "isActive" AND ("validTo" IS NULL OR "validTo">=effective))
 OR EXISTS(SELECT 1 FROM public."StaffFlexibleWeekPlan" WHERE "staffProfileId"=staff AND "weekStartDate"+6>=effective)
 OR EXISTS(SELECT 1 FROM public."StaffFlexibleAvailability" WHERE "staffProfileId"=staff AND date>=effective)
 OR EXISTS(SELECT 1 FROM public."StaffShiftOverride" WHERE "staffProfileId"=staff AND date>=effective)
 OR EXISTS(SELECT 1 FROM public."Appointment" WHERE "staffProfileId"=staff AND "tenantId"=t AND (status='IN_PROGRESS' OR (status IN ('SCHEDULED','CONFIRMED') AND "endAt">timezone('UTC',now()) AND "endAt">timezone('UTC',effective::timestamp AT TIME ZONE zone)))) THEN RAISE EXCEPTION 'Resolve active or future work before changing workplace' USING ERRCODE='40001'; END IF;
 before_doc:=jsonb_build_object('version',v,'workplace',to_jsonb(latest),'previous',to_jsonb(previous));
 IF cancel_id IS NOT NULL THEN
  UPDATE public."StaffWorkplaceAssignment" SET "canceledAt"=timezone('UTC',clock_timestamp()),"updatedAt"=timezone('UTC',clock_timestamp()) WHERE id=latest.id;
  UPDATE public."StaffWorkplaceAssignment" SET "endDate"=NULL,"updatedAt"=timezone('UTC',clock_timestamp()) WHERE id=previous.id;
  next_id:=latest.id;ids:=array_remove(ARRAY[latest.id,previous.id],NULL);audit_event:='workforce.workplace.canceled';
 ELSE
  UPDATE public."StaffWorkplaceAssignment" SET "endDate"=effective-1,"updatedAt"=timezone('UTC',clock_timestamp()) WHERE id=latest.id;
  next_id:=gen_random_uuid()::text;
  INSERT INTO public."StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","startDate","updatedAt") VALUES(next_id,t,staff,destination,effective,timezone('UTC',clock_timestamp()));
  ids:=array_remove(ARRAY[latest.id,next_id],NULL);audit_event:=CASE WHEN latest.id IS NULL THEN 'workforce.workplace.assigned' ELSE 'workforce.workplace.transferred' END;
 END IF;
 UPDATE public."StaffWorkplacePolicy" SET version=version+1,"updatedAt"=timezone('UTC',clock_timestamp()) WHERE "tenantId"=t AND "staffProfileId"=staff;
 SELECT jsonb_build_object('version',v+1,'placements',jsonb_agg(to_jsonb(a) ORDER BY id)) INTO after_doc FROM public."StaffWorkplaceAssignment" a WHERE a.id=ANY(ids);
 INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId",metadata,before,after) SELECT gen_random_uuid()::text,t,audit_event,'StaffWorkplaceAssignment',next_id,caller,u.role,left(request_id,200),jsonb_build_object('staffProfileId',staff,'placementIds',ids),before_doc,after_doc FROM public."User" u WHERE u.id=caller AND u."tenantId"=t;
 RETURN next_id;
END $$;

CREATE FUNCTION app.workplace_audit_readable(t text,details jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE k text; row public."StaffWorkplaceAssignment"%ROWTYPE;
BEGIN
 IF jsonb_typeof(details->'placementIds') IS DISTINCT FROM 'array' OR jsonb_array_length(details->'placementIds')=0 THEN RETURN false; END IF;
 FOR k IN SELECT jsonb_array_elements_text(details->'placementIds') LOOP
  SELECT * INTO row FROM public."StaffWorkplaceAssignment" WHERE "tenantId"=t AND id=k;
  IF NOT FOUND OR NOT app.workplace_readable(t,row."staffProfileId",row."officeId") THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE POLICY workplace_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING("entityType" IS DISTINCT FROM 'StaffWorkplaceAssignment' OR app.workplace_audit_readable("tenantId",metadata));
COMMIT;
