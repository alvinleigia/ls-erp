BEGIN;
-- Names for an office already available to the caller. This grants neither
-- directory administration nor access to any business record in that office.
CREATE FUNCTION app.record_office_label(t text,o text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('id',b.id,'name',b.name,'companyName',c.name,
   'active',NOT b.archived AND NOT c.archived)
 FROM public."BusinessOffice" b JOIN public."BusinessCompany" c
 ON c."tenantId"=b."tenantId" AND c.id=b."companyId"
 WHERE b."tenantId"=t AND b.id=o
 AND app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))
$$;
COMMIT;
