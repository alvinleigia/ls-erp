BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Appointment ownership requires BYPASSRLS'; END IF;
 -- Infer missing historical tenant identity only from agreeing native relations.
 IF EXISTS(SELECT 1 FROM "Appointment" a JOIN "StaffProfile" p ON p.id=a."staffProfileId" JOIN "User" s ON s.id=p."userId" JOIN "User" c ON c.id=a."customerId" JOIN "Service" v ON v.id=a."serviceId" WHERE s."tenantId" IS NULL OR s."tenantId" IS DISTINCT FROM c."tenantId" OR s."tenantId" IS DISTINCT FROM v."tenantId" OR (a."tenantId" IS NOT NULL AND a."tenantId" IS DISTINCT FROM s."tenantId")) THEN RAISE EXCEPTION 'Appointment historical tenant relations disagree'; END IF;
 IF EXISTS(SELECT 1 FROM "AppointmentOrder" o JOIN "User" c ON c.id=o."customerId" WHERE c."tenantId" IS NULL OR (o."tenantId" IS NOT NULL AND o."tenantId" IS DISTINCT FROM c."tenantId")) THEN RAISE EXCEPTION 'Booking historical tenant relations disagree'; END IF;
END $$;
UPDATE "Appointment" a SET "tenantId"=u."tenantId" FROM "User" u WHERE u.id=a."customerId" AND a."tenantId" IS NULL;
UPDATE "AppointmentOrder" a SET "tenantId"=u."tenantId" FROM "User" u WHERE u.id=a."customerId" AND a."tenantId" IS NULL;
ALTER TABLE "Appointment" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "AppointmentOrder" ALTER COLUMN "tenantId" SET NOT NULL;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['AppointmentOrder','Appointment'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN "officeId" text',tbl);
  EXECUTE format('UPDATE %I r SET "officeId"=o.id FROM "BusinessOffice" o WHERE o."tenantId"=r."tenantId" AND o."isInitial"',tbl);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN "officeId" SET NOT NULL,ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id()',tbl);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED',tbl,tbl||'_tenantId_officeId_fkey');
  EXECUTE format('CREATE INDEX %I ON %I("tenantId","officeId")',tbl||'_tenantId_officeId_idx',tbl);
 END LOOP;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "AppointmentOrderLine" l JOIN "AppointmentOrder" o ON o.id=l."orderId" JOIN "StaffProfile" p ON p.id=l."staffProfileId" JOIN "User" u ON u.id=p."userId" JOIN "Service" s ON s.id=l."serviceId" WHERE u."tenantId" IS DISTINCT FROM o."tenantId" OR s."tenantId" IS DISTINCT FROM o."tenantId") OR EXISTS(SELECT 1 FROM "Appointment" a JOIN "AppointmentOrderLine" l ON l.id=a."orderLineId" JOIN "AppointmentOrder" o ON o.id=l."orderId" WHERE a."tenantId" IS DISTINCT FROM o."tenantId" OR a."customerId" IS DISTINCT FROM o."customerId" OR a."serviceId" IS DISTINCT FROM l."serviceId" OR a."staffProfileId" IS DISTINCT FROM l."staffProfileId" OR a."startAt" IS DISTINCT FROM l."startAt" OR a."endAt" IS DISTINCT FROM l."endAt") OR EXISTS(SELECT 1 FROM "AppointmentOrderProductLine" l JOIN "AppointmentOrder" o ON o.id=l."orderId" JOIN "InventoryProduct" p ON p.id=l."productId" WHERE p."tenantId" IS DISTINCT FROM o."tenantId") THEN RAISE EXCEPTION 'Booking historical source relations disagree'; END IF;
END $$;
UPDATE "Appointment" a SET "officeId"=o."officeId" FROM "AppointmentOrderLine" l JOIN "AppointmentOrder" o ON o.id=l."orderId" WHERE l.id=a."orderLineId";

CREATE FUNCTION app.booking_capability(t text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND p=ANY(ARRAY['appointments.read','appointments.create','appointments.edit','appointments.archive','appointments.export','appointmentCoupons.read']) AND EXISTS(
 SELECT 1 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" JOIN public."TenantModule" m ON m."tenantId"=tenant.id AND m.key='appointments' AND m.allowed AND m.enabled WHERE tenant.id=t AND tenant.status='ACTIVE' AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id AND policy.rules->>p='ALL' AND policy.rules->>(split_part(p,'.',1)||'.read')='ALL'
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions)))))
$$;
REVOKE ALL ON FUNCTION app.booking_capability(text,text) FROM PUBLIC;
CREATE FUNCTION app.booking_office_read(t text,o text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.booking_capability(t,'appointments.read') AND app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))
$$;
CREATE FUNCTION app.booking_order_read(k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."AppointmentOrder" o WHERE o.id=k AND app.booking_office_read(o."tenantId",o."officeId"))
$$;
CREATE FUNCTION app.booking_creation_office(t text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o text:=app.creation_office_id();caller text:=nullif(current_setting('app.actor_id',true),''); BEGIN
 IF NOT COALESCE(app.booking_capability(t,'appointments.read'),false) OR o IS NULL OR nullif(current_setting('app.office_version',true),'') IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=caller AND p."creationOfficeId"=o AND p.version::text=current_setting('app.office_version',true)) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001';END IF;
 IF NOT app.business_office_allowed(t,o,caller) THEN RAISE EXCEPTION 'Booking office access is not permitted' USING ERRCODE='42501'; END IF;
 RETURN o;
END $$;
CREATE FUNCTION app.booking_target(t text,o text,staff text,first_time timestamptz,last_time timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off SET jit=off AS $$
 SELECT first_time IS NOT NULL AND last_time>first_time AND isfinite(first_time) AND isfinite(last_time)
 AND EXISTS(SELECT 1 FROM public."StaffProfile" p JOIN public."User" u ON u.id=p."userId" WHERE p.id=staff AND u."tenantId"=t AND u.role='STAFF' AND u.status='ACTIVE' AND app.office_assignment_allowed(t,o,u.id))
 AND EXISTS(SELECT 1 FROM public."StaffWorkplaceAssignment" w WHERE w."tenantId"=t AND w."staffProfileId"=staff AND w."officeId"=o AND w."canceledAt" IS NULL
  AND (w."startDate" IS NULL OR w."startDate"<=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),first_time)::date)
  AND (w."endDate" IS NULL OR w."endDate">=timezone(COALESCE((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=t),'UTC'),last_time-interval '1 microsecond')::date))
$$;
REVOKE ALL ON FUNCTION app.booking_target(text,text,text,timestamptz,timestamptz) FROM PUBLIC;
CREATE FUNCTION app.booking_assignment_allowed(t text,o text,staff text,first_time timestamptz,last_time timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.booking_capability(t,'appointments.read') AND app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')) AND app.booking_target(t,o,staff,first_time,last_time)
$$;
CREATE FUNCTION app.booking_office_label(t text,o text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('id',b.id,'name',b.name,'companyName',c.name,'active',NOT b.archived AND NOT c.archived) FROM public."BusinessOffice" b JOIN public."BusinessCompany" c ON c."tenantId"=b."tenantId" AND c.id=b."companyId" WHERE b."tenantId"=t AND b.id=o AND app.booking_office_read(t,o)
$$;

CREATE FUNCTION app.booking_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r jsonb;prior jsonb;t text;o text;parent text;op text:=nullif(current_setting('app.appointment_operation',true),'');permission text;fresh boolean:=false;changed boolean; BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_OP='DELETE' THEN r:=to_jsonb(OLD);ELSE r:=to_jsonb(NEW);END IF;
 IF TG_OP='UPDATE' THEN prior:=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME IN ('Appointment','AppointmentOrder') THEN t:=r->>'tenantId';o:=r->>'officeId';
 ELSE parent:=r->>'orderId';SELECT p."tenantId",p."officeId",p.xmin::text::bigint=mod(txid_current(),4294967296) INTO t,o,fresh FROM public."AppointmentOrder" p WHERE p.id=parent;END IF;
 IF TG_TABLE_NAME='Appointment' AND TG_OP='INSERT' AND r->>'orderLineId' IS NOT NULL THEN
  SELECT p."officeId" INTO o FROM public."AppointmentOrderLine" l JOIN public."AppointmentOrder" p ON p.id=l."orderId" WHERE l.id=r->>'orderLineId' AND p."tenantId"=t;
  NEW."officeId":=o;r:=to_jsonb(NEW);
 END IF;
 IF t IS NULL AND TG_OP='DELETE' AND TG_TABLE_NAME NOT IN ('Appointment','AppointmentOrder') THEN RETURN OLD;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 IF op IS NULL OR op NOT IN ('appointments.create','appointments.edit','appointments.archive') OR t IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR NOT COALESCE(app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Booking office access is not permitted' USING ERRCODE='42501';END IF;
 permission:=CASE TG_OP WHEN 'INSERT' THEN 'appointments.create' WHEN 'DELETE' THEN 'appointments.archive' ELSE 'appointments.edit' END;
 IF TG_TABLE_NAME='Appointment' AND TG_OP='INSERT' AND r->>'orderLineId' IS NOT NULL AND op='appointments.edit' THEN permission:=op;END IF;
 IF TG_TABLE_NAME NOT IN ('Appointment','AppointmentOrder') THEN permission:=CASE WHEN op='appointments.create' AND fresh AND TG_OP='INSERT' THEN op ELSE 'appointments.edit' END;END IF;
 -- An archive-only cancellation may touch the linked order's concurrency token.
 IF TG_TABLE_NAME='AppointmentOrder' AND TG_OP='UPDATE' AND op='appointments.archive' AND (r-'updatedAt')=(prior-'updatedAt') THEN permission:=op;END IF;
 IF TG_TABLE_NAME='Appointment' AND TG_OP='UPDATE' AND op='appointments.archive' AND r->>'status'='CANCELED' AND (r-ARRAY['updatedAt','status'])=(prior-ARRAY['updatedAt','status']) THEN permission:=op;END IF;
 IF NOT COALESCE(app.booking_capability(t,permission),false) THEN RAISE EXCEPTION 'Booking office access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' AND (r->>'id' IS DISTINCT FROM prior->>'id' OR (TG_TABLE_NAME IN ('Appointment','AppointmentOrder') AND (r->>'tenantId' IS DISTINCT FROM prior->>'tenantId' OR r->>'officeId' IS DISTINCT FROM prior->>'officeId')) OR (TG_TABLE_NAME NOT IN ('Appointment','AppointmentOrder') AND r->>'orderId' IS DISTINCT FROM prior->>'orderId') OR (TG_TABLE_NAME='Appointment' AND r->>'orderLineId' IS DISTINCT FROM prior->>'orderLineId')) THEN RAISE EXCEPTION 'Record office and identity are immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('Appointment','AppointmentOrder') AND r->>'status' IS DISTINCT FROM prior->>'status' AND ('CANCELED' IN (r->>'status',prior->>'status')) AND NOT COALESCE(app.booking_capability(t,'appointments.archive'),false) THEN RAISE EXCEPTION 'Booking office access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN ('Appointment','AppointmentOrder') THEN
  IF TG_TABLE_NAME='Appointment' AND r->>'orderLineId' IS NOT NULL THEN
   SELECT p."officeId",p.xmin::text::bigint=mod(txid_current(),4294967296) INTO o,fresh FROM public."AppointmentOrderLine" l JOIN public."AppointmentOrder" p ON p.id=l."orderId" WHERE l.id=r->>'orderLineId' AND p."tenantId"=t;
   IF o IS NULL OR NOT app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')) OR (NOT fresh AND NOT app.booking_capability(t,'appointments.edit')) THEN RAISE EXCEPTION 'Booking office access is not permitted' USING ERRCODE='42501';END IF;
   NEW."officeId":=o;r:=to_jsonb(NEW);
  ELSIF o IS DISTINCT FROM app.booking_creation_office(t) THEN RAISE EXCEPTION 'Booking office access is not permitted' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='Appointment' THEN
  IF NOT EXISTS(SELECT 1 FROM public."User" c JOIN public."Service" v ON v.id=r->>'serviceId' JOIN public."StaffProfile" p ON p.id=r->>'staffProfileId' JOIN public."User" s ON s.id=p."userId" WHERE c.id=r->>'customerId' AND c."tenantId"=t AND v."tenantId"=t AND s."tenantId"=t) THEN RAISE EXCEPTION 'Booking source identity is not permitted' USING ERRCODE='23514';END IF;
  IF r->>'orderLineId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."AppointmentOrderLine" l JOIN public."AppointmentOrder" p ON p.id=l."orderId" WHERE l.id=r->>'orderLineId' AND p."tenantId"=t AND p."officeId"=o AND p."customerId"=r->>'customerId' AND l."serviceId"=r->>'serviceId' AND l."staffProfileId"=r->>'staffProfileId' AND l."startAt"=(r->>'startAt')::timestamp AND l."endAt"=(r->>'endAt')::timestamp) THEN
   -- Appointment-first operational edits synchronize their financial source later
   -- in this same transaction. The deferred source check below proves coherence.
   IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Booking source identity is not permitted' USING ERRCODE='23514';END IF;
  END IF;
  changed:=TG_OP='INSERT' OR r->>'staffProfileId' IS DISTINCT FROM prior->>'staffProfileId' OR r->>'startAt' IS DISTINCT FROM prior->>'startAt' OR r->>'endAt' IS DISTINCT FROM prior->>'endAt' OR (r->>'status' IN ('SCHEDULED','CONFIRMED','IN_PROGRESS') AND COALESCE(prior->>'status','') NOT IN ('SCHEDULED','CONFIRMED','IN_PROGRESS'));
  IF changed AND NOT COALESCE(app.booking_target(t,o,r->>'staffProfileId',((r->>'startAt')::timestamp AT TIME ZONE 'UTC'),((r->>'endAt')::timestamp AT TIME ZONE 'UTC')),false) THEN RAISE EXCEPTION 'Staff must cover the booking office and dates' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='AppointmentOrder' AND NOT EXISTS(SELECT 1 FROM public."User" u WHERE u.id=r->>'customerId' AND u."tenantId"=t) THEN RAISE EXCEPTION 'Booking source identity is not permitted' USING ERRCODE='23514';END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='AppointmentOrderLine' THEN
  IF NOT EXISTS(SELECT 1 FROM public."Service" v JOIN public."StaffProfile" p ON p.id=r->>'staffProfileId' JOIN public."User" u ON u.id=p."userId" WHERE v.id=r->>'serviceId' AND v."tenantId"=t AND u."tenantId"=t) THEN RAISE EXCEPTION 'Booking source identity is not permitted' USING ERRCODE='23514';END IF;
  IF (TG_OP='INSERT' OR r->>'staffProfileId' IS DISTINCT FROM prior->>'staffProfileId' OR r->>'startAt' IS DISTINCT FROM prior->>'startAt' OR r->>'endAt' IS DISTINCT FROM prior->>'endAt') AND NOT COALESCE(app.booking_target(t,o,r->>'staffProfileId',((r->>'startAt')::timestamp AT TIME ZONE 'UTC'),((r->>'endAt')::timestamp AT TIME ZONE 'UTC')),false) THEN RAISE EXCEPTION 'Staff must cover the booking office and dates' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='AppointmentOrderProductLine' AND NOT EXISTS(SELECT 1 FROM public."InventoryProduct" p WHERE p.id=r->>'productId' AND p."tenantId"=t) THEN RAISE EXCEPTION 'Booking source identity is not permitted' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['Appointment','AppointmentOrder','AppointmentOrderLine','AppointmentOrderProductLine','AppointmentOrderCoupon','AppointmentOrderTax'] LOOP
  EXECUTE format('CREATE TRIGGER booking_ownership BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.booking_owner()',tbl);
  IF tbl IN ('Appointment','AppointmentOrder') THEN EXECUTE format('CREATE POLICY booking_office ON %I AS RESTRICTIVE FOR ALL USING(current_setting(''app.rls_bypass'',true)=''on'' OR app.booking_office_read("tenantId","officeId")) WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'' OR app.booking_office_read("tenantId","officeId"))',tbl);
  ELSE EXECUTE format('CREATE POLICY booking_office ON %I AS RESTRICTIVE FOR ALL USING(current_setting(''app.rls_bypass'',true)=''on'' OR app.booking_order_read("orderId")) WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'' OR app.booking_order_read("orderId"))',tbl);END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.booking_link_coherent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public."Appointment" a JOIN public."AppointmentOrderLine" l ON l.id=a."orderLineId" JOIN public."AppointmentOrder" o ON o.id=l."orderId" WHERE ((TG_TABLE_NAME='Appointment' AND a.id=NEW.id) OR (TG_TABLE_NAME='AppointmentOrderLine' AND l.id=NEW.id) OR (TG_TABLE_NAME='AppointmentOrder' AND o.id=NEW.id)) AND (a."tenantId" IS DISTINCT FROM o."tenantId" OR a."officeId" IS DISTINCT FROM o."officeId" OR a."customerId" IS DISTINCT FROM o."customerId" OR a."serviceId" IS DISTINCT FROM l."serviceId" OR a."staffProfileId" IS DISTINCT FROM l."staffProfileId" OR a."startAt" IS DISTINCT FROM l."startAt" OR a."endAt" IS DISTINCT FROM l."endAt")) THEN RAISE EXCEPTION 'Booking source identity is not permitted' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='AppointmentOrder' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'status'='CONFIRMED' AND to_jsonb(OLD)->>'status'<>'CONFIRMED' AND EXISTS(SELECT 1 FROM public."AppointmentOrderLine" l JOIN public."AppointmentOrder" o ON o.id=l."orderId" WHERE o.id=NEW.id AND NOT COALESCE(app.booking_target(o."tenantId",o."officeId",l."staffProfileId",l."startAt" AT TIME ZONE 'UTC',l."endAt" AT TIME ZONE 'UTC'),false)) THEN RAISE EXCEPTION 'Staff must cover the booking office and dates' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER booking_link_coherent AFTER INSERT OR UPDATE ON "Appointment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.booking_link_coherent();
CREATE CONSTRAINT TRIGGER booking_link_coherent AFTER INSERT OR UPDATE ON "AppointmentOrderLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.booking_link_coherent();
CREATE CONSTRAINT TRIGGER booking_link_coherent AFTER INSERT OR UPDATE ON "AppointmentOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.booking_link_coherent();
UPDATE "AuditLog" a SET metadata=COALESCE(a.metadata,'{}'::jsonb)||jsonb_build_object('officeId',o.id,'officeFamily','appointments') FROM "BusinessOffice" o WHERE o."tenantId"=a."tenantId" AND o."isInitial" AND (a."entityType"='Appointment' OR (a."entityType"='order' AND a.event LIKE 'appointments.%'));
CREATE POLICY booking_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING(("entityType" IS DISTINCT FROM 'Appointment' AND NOT ("entityType"='order' AND event LIKE 'appointments.%')) OR app.booking_office_read("tenantId",metadata->>'officeId'));
CREATE FUNCTION app.booking_coupon_usage(t text,codes text[],customer text,excluded text) RETURNS TABLE(code text,"customerUses" integer,"totalUses" integer) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off SET jit=off AS $$
BEGIN
 IF NOT COALESCE(app.booking_capability(t,'appointments.read') AND app.booking_capability(t,'appointmentCoupons.read'),false) OR codes IS NULL OR cardinality(codes)>100 OR array_position(codes,NULL) IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."User" u WHERE u.id=customer AND u."tenantId"=t AND u.role='CUSTOMER') OR (excluded IS NOT NULL AND NOT app.booking_order_read(excluded)) THEN RAISE EXCEPTION 'Coupon integrity access is not permitted' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT c.code,count(*) FILTER(WHERE o."customerId"=customer)::integer,count(*)::integer FROM public."AppointmentOrderCoupon" c JOIN public."AppointmentOrder" o ON o.id=c."orderId" WHERE o."tenantId"=t AND c.code=ANY(codes) AND o.status<>'CANCELED' AND (excluded IS NULL OR o.id<>excluded) GROUP BY c.code;
END $$;
CREATE FUNCTION app.booking_coupon_used(t text,k text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF NOT COALESCE(app.booking_capability(t,'appointmentCoupons.read'),false) THEN RAISE EXCEPTION 'Coupon integrity access is not permitted' USING ERRCODE='42501';END IF;
 RETURN EXISTS(SELECT 1 FROM public."AppointmentOrderCoupon" c JOIN public."AppointmentOrder" o ON o.id=c."orderId" WHERE o."tenantId"=t AND c.code=k);
END $$;
COMMIT;
