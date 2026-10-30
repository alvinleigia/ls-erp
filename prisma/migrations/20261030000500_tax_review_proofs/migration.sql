BEGIN;
-- Validate every changed version, including intermediate revisions within one
-- transaction. Checking only the final head could leave incomplete history.
CREATE OR REPLACE FUNCTION app.tax_configuration_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r public."CompanyTaxRegistration"%ROWTYPE;s jsonb;v jsonb;c jsonb;j jsonb:=to_jsonb(NEW);key text;review_version integer;expected jsonb;total integer:=0;
BEGIN
 IF TG_TABLE_NAME IN ('CompanyTaxRegistration','CompanyTaxRegistrationRevision') THEN
  key:=j->>(CASE WHEN TG_TABLE_NAME='CompanyTaxRegistration' THEN 'id' ELSE 'registrationId' END);
  review_version:=(j->>'version')::integer;
  IF TG_TABLE_NAME='CompanyTaxRegistration' THEN r:=NEW;expected:=app.tax_registration_snapshot(r);ELSE expected:=j->'snapshot';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."CompanyTaxRegistrationRevision" x WHERE x."tenantId"=NEW."tenantId" AND x."registrationId"=key AND x.version=review_version AND x.snapshot=expected) THEN RAISE EXCEPTION 'Every registration update requires immutable reviewed history' USING ERRCODE='23514';END IF;
 ELSE
  key:=j->>(CASE WHEN TG_TABLE_NAME='CompanyTaxProfile' THEN 'id' ELSE 'profileId' END);
  review_version:=coalesce((j->>'profileVersion')::integer,(j->>'version')::integer);
  SELECT snapshot INTO s FROM public."CompanyTaxProfileVersion" WHERE "tenantId"=NEW."tenantId" AND "profileId"=key AND version=review_version;
  IF s IS NULL OR TG_TABLE_NAME='CompanyTaxProfile' AND (s->>'name' IS DISTINCT FROM j->>'name' OR s->>'enabled' IS DISTINCT FROM j->>'enabled' OR s->>'scheme' IS DISTINCT FROM j->>'scheme') THEN RAISE EXCEPTION 'Every tax profile update requires immutable reviewed history' USING ERRCODE='23514';END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(s->'variants') LOOP FOR c IN SELECT * FROM jsonb_array_elements(v->'components') LOOP
   total:=total+1;
   IF NOT EXISTS(SELECT 1 FROM public."CompanyTaxProfileRate" x WHERE x."tenantId"=NEW."tenantId" AND x."profileId"=key AND x."profileVersion"=review_version AND x."variantKey"=v->>'key' AND x."componentCode"=c->>'code' AND x."taxId"=c->>'rateId' AND x.name=c->>'name' AND x.percent=(c->>'percent')::numeric AND x."sourceUpdatedAt"=(c->>'sourceUpdatedAt')::timestamptz AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Every tax profile version must retain complete reviewed rate facts' USING ERRCODE='23514';END IF;
  END LOOP;END LOOP;
  IF total<>(SELECT count(*) FROM public."CompanyTaxProfileRate" x WHERE x."tenantId"=NEW."tenantId" AND x."profileId"=key AND x."profileVersion"=review_version) THEN RAISE EXCEPTION 'Tax profile component count mismatch' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
COMMIT;
