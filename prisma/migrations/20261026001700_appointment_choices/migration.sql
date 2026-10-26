BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Booking choices require BYPASSRLS'; END IF;
END $$;
-- Names are delegated only within the caller's booking boundary. This lookup
-- grants no mutation; the independent native booking guards remain mandatory.
CREATE FUNCTION app.booking_staff_choices(t text,family text,action text,source text,office_filter text,first_time timestamptz,last_time timestamptz,selected text[],q text,n integer,skip integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off SET jit=off AS $$
DECLARE o text; retained_profiles text[]:=ARRAY[]::text[]; result jsonb; BEGIN
 IF family IS NULL OR family NOT IN ('APPOINTMENT','ORDER') OR action IS NULL OR action NOT IN ('browse','create','edit') OR n IS NULL OR n NOT BETWEEN 1 AND 100 OR skip IS NULL OR skip NOT BETWEEN 0 AND 1000000 OR q IS NULL OR length(q)>160 OR selected IS NULL OR cardinality(selected)>100 OR array_position(selected,NULL) IS NOT NULL OR (first_time IS NOT NULL AND NOT isfinite(first_time)) OR (last_time IS NOT NULL AND NOT isfinite(last_time)) OR (first_time IS NOT NULL AND last_time IS NOT NULL AND last_time<=first_time) THEN RAISE EXCEPTION 'Invalid booking staff selection' USING ERRCODE='22023'; END IF;
 IF NOT COALESCE(app.booking_capability(t,'appointments.read'),false) OR (action<>'browse' AND NOT COALESCE(app.booking_capability(t,'appointments.'||action),false)) THEN RAISE EXCEPTION 'Booking choices access is not permitted' USING ERRCODE='42501'; END IF;
 IF action='browse' THEN
  IF source IS NOT NULL THEN RAISE EXCEPTION 'Invalid booking staff selection' USING ERRCODE='22023';END IF;
  IF family='APPOINTMENT' THEN
   SELECT COALESCE(array_agg(DISTINCT a."staffProfileId"),ARRAY[]::text[]) INTO retained_profiles FROM public."Appointment" a WHERE a."tenantId"=t AND app.booking_office_read(t,a."officeId") AND (office_filter IS NULL OR a."officeId"=office_filter) AND (first_time IS NULL OR a."startAt">=first_time AT TIME ZONE 'UTC') AND (last_time IS NULL OR a."startAt"<last_time AT TIME ZONE 'UTC');
  ELSE
   SELECT COALESCE(array_agg(DISTINCT l."staffProfileId"),ARRAY[]::text[]) INTO retained_profiles FROM public."AppointmentOrderLine" l JOIN public."AppointmentOrder" r ON r.id=l."orderId" WHERE r."tenantId"=t AND app.booking_order_read(r.id) AND (office_filter IS NULL OR r."officeId"=office_filter) AND (first_time IS NULL OR r."appointmentStartAt">=first_time AT TIME ZONE 'UTC') AND (last_time IS NULL OR r."appointmentStartAt"<last_time AT TIME ZONE 'UTC');
  END IF;
 ELSE
  IF first_time IS NULL OR last_time IS NULL OR office_filter IS NOT NULL THEN RAISE EXCEPTION 'Invalid booking staff selection' USING ERRCODE='22023';END IF;
  IF action='create' THEN
   IF source IS NOT NULL THEN RAISE EXCEPTION 'Invalid booking staff selection' USING ERRCODE='22023';END IF;
   o:=app.booking_creation_office(t);
  ELSIF family='APPOINTMENT' THEN
   SELECT a."officeId",ARRAY[a."staffProfileId"] INTO o,retained_profiles FROM public."Appointment" a WHERE a."tenantId"=t AND a.id=source AND app.booking_office_read(t,a."officeId");
  ELSE
   SELECT r."officeId" INTO o FROM public."AppointmentOrder" r WHERE r."tenantId"=t AND r.id=source AND app.booking_order_read(r.id);
   SELECT COALESCE(array_agg(l."staffProfileId"),ARRAY[]::text[]) INTO retained_profiles FROM public."AppointmentOrderLine" l WHERE l."orderId"=source AND o IS NOT NULL;
  END IF;
  IF o IS NULL THEN RAISE EXCEPTION 'Booking staff source not found' USING ERRCODE='P0002';END IF;
  IF NOT COALESCE(app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Booking choices access is not permitted' USING ERRCODE='42501';END IF;
 END IF;
 WITH candidates AS MATERIALIZED (
  SELECT u.id,u.name,u.email,p.id=ANY(retained_profiles) retained,
   CASE WHEN action='browse' THEN false ELSE app.booking_target(t,o,p.id,first_time,last_time) END eligible
  FROM public."User" u JOIN public."StaffProfile" p ON p."userId"=u.id WHERE u."tenantId"=t AND (action<>'browse' OR p.id=ANY(retained_profiles)) AND (q='' OR u.name ILIKE '%'||q||'%' OR u.email ILIKE '%'||q||'%' OR u.id=ANY(selected))
 ), visible AS MATERIALIZED (
  SELECT *,jsonb_build_object('id',id,'name',name,'email',email,'eligible',COALESCE(eligible,false),'retained',retained) dto FROM candidates WHERE (action='browse' AND retained) OR (action<>'browse' AND (eligible OR (retained AND id=ANY(selected))))
 ), matching AS MATERIALIZED (SELECT * FROM visible WHERE q='' OR name ILIKE '%'||q||'%' OR email ILIKE '%'||q||'%'), page AS (SELECT * FROM matching ORDER BY name NULLS LAST,id LIMIT n OFFSET skip)
 SELECT jsonb_build_object('office',CASE WHEN o IS NOT NULL THEN app.booking_office_label(t,o) ELSE NULL END,'items',COALESCE((SELECT jsonb_agg(dto ORDER BY name NULLS LAST,id) FROM page),'[]'::jsonb),'selected',COALESCE((SELECT jsonb_agg(dto ORDER BY name NULLS LAST,id) FROM visible WHERE id=ANY(selected)),'[]'::jsonb),'total',(SELECT count(*) FROM matching)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION app.booking_office_choices(t text,selected text,q text,n integer,skip integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE result jsonb; BEGIN
 IF NOT COALESCE(app.booking_capability(t,'appointments.read'),false) THEN RAISE EXCEPTION 'Booking choices access is not permitted' USING ERRCODE='42501';END IF;
 IF q IS NULL OR length(q)>160 OR n IS NULL OR n NOT BETWEEN 1 AND 100 OR skip IS NULL OR skip NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid booking staff selection' USING ERRCODE='22023';END IF;
 WITH visible AS MATERIALIZED (SELECT b.id,b.name,c.name company,app.booking_office_label(t,b.id) dto FROM public."BusinessOffice" b JOIN public."BusinessCompany" c ON c."tenantId"=b."tenantId" AND c.id=b."companyId" WHERE b."tenantId"=t AND app.booking_office_read(t,b.id)), matching AS MATERIALIZED (SELECT * FROM visible WHERE q='' OR name ILIKE '%'||q||'%' OR company ILIKE '%'||q||'%'), page AS (SELECT * FROM matching ORDER BY company,name,id LIMIT n OFFSET skip)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(dto ORDER BY company,name,id) FROM page),'[]'::jsonb),'selected',(SELECT dto FROM visible WHERE id=selected),'total',(SELECT count(*) FROM matching)) INTO result;
 RETURN result;
END $$;
COMMIT;
