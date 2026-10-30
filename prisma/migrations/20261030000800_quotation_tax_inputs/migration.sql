BEGIN;
CREATE TABLE "QuotationTaxInputReview" (
 id text PRIMARY KEY,"tenantId" text NOT NULL,"quotationId" text NOT NULL,revision integer NOT NULL,
 "officeId" text NOT NULL,"companyId" text NOT NULL,"mappingVersion" integer NOT NULL CHECK("mappingVersion">0),
 "issuerId" text NOT NULL,"issuerVersion" integer NOT NULL,"recipientId" text NOT NULL,"recipientVersion" integer NOT NULL,
 "proposedSupplyOn" date NOT NULL,"issuerSnapshot" jsonb NOT NULL,"recipientSnapshot" jsonb NOT NULL,"createdBy" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","quotationId",revision) REFERENCES "CrmQuotationRevision"("tenantId","quotationId",number) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","companyId","officeId") REFERENCES "BusinessOffice"("tenantId","companyId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","issuerId","issuerVersion") REFERENCES "CompanyTaxRegistrationRevision"("tenantId","registrationId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","recipientId","recipientVersion") REFERENCES "PartyTaxIdentityRevision"("tenantId","identityId",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QuotationTaxInputReview_tenantId_id_key" ON "QuotationTaxInputReview"("tenantId",id);
CREATE UNIQUE INDEX "QuotationTaxInputReview_tenantId_quotationId_revision_key" ON "QuotationTaxInputReview"("tenantId","quotationId",revision);
CREATE TABLE "QuotationTaxInputLine" (
 "tenantId" text NOT NULL,"reviewId" text NOT NULL,"lineIndex" integer NOT NULL CHECK("lineIndex" BETWEEN 0 AND 29),"profileId" text NOT NULL,"profileVersion" integer NOT NULL,"profileSnapshot" jsonb NOT NULL,
 variant text NOT NULL CHECK(variant IN ('NONE','INTRA_STATE','INTER_STATE')),"placeCountryCode" text NOT NULL CHECK("placeCountryCode"='IN'),"placeRegionCode" text NOT NULL CHECK("placeRegionCode" ~ '^(0[1-9]|[12][0-9]|3[0-8]|97)$'),"placeBasis" text NOT NULL CHECK(length(btrim("placeBasis")) BETWEEN 10 AND 1000),
 PRIMARY KEY("tenantId","reviewId","lineIndex"),
 FOREIGN KEY("tenantId","reviewId") REFERENCES "QuotationTaxInputReview"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","profileId","profileVersion") REFERENCES "CompanyTaxProfileVersion"("tenantId","profileId",version) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION app.quotation_tax_inputs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Reviewed tax inputs are immutable; save a new quotation revision' USING ERRCODE='23514';END $$;
CREATE TRIGGER quotation_tax_inputs_immutable BEFORE UPDATE OR DELETE ON "QuotationTaxInputReview" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_immutable();
CREATE TRIGGER quotation_tax_inputs_immutable BEFORE UPDATE OR DELETE ON "QuotationTaxInputLine" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_immutable();
CREATE FUNCTION app.quotation_tax_inputs_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE q public."CrmQuotation"%ROWTYPE;s jsonb;party jsonb;r public."CompanyTaxRegistration"%ROWTYPE;p public."PartyTaxIdentity"%ROWTYPE;review public."QuotationTaxInputReview"%ROWTYPE;profile public."CompanyTaxProfile"%ROWTYPE;stored jsonb;source_office text;
BEGIN
 IF TG_TABLE_NAME='QuotationTaxInputReview' THEN
  SELECT * INTO q FROM public."CrmQuotation" WHERE "tenantId"=NEW."tenantId" AND id=NEW."quotationId" FOR UPDATE;
  SELECT snapshot INTO s FROM public."CrmQuotationRevision" WHERE "tenantId"=NEW."tenantId" AND "quotationId"=NEW."quotationId" AND number=NEW.revision;
  IF q.id IS NULL OR q.version<>NEW.revision OR s IS NULL OR EXISTS(SELECT 1 FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND "quotationId"=NEW."quotationId" AND revision=NEW.revision) THEN RAISE EXCEPTION 'Tax preparation: use a current quotation revision that has never been ordered' USING ERRCODE='23514';END IF;
  SELECT o."officeId" INTO source_office FROM public."CrmOpportunity" o WHERE o."tenantId"=NEW."tenantId" AND o.id=q."opportunityId";
  PERFORM m."officeId" FROM public."OfficeTaxRegistration" m WHERE m."tenantId"=NEW."tenantId" AND m."officeId"=NEW."officeId" FOR SHARE;
  SELECT * INTO r FROM public."CompanyTaxRegistration" WHERE "tenantId"=NEW."tenantId" AND id=NEW."issuerId" FOR SHARE;
  SELECT * INTO p FROM public."PartyTaxIdentity" WHERE "tenantId"=NEW."tenantId" AND id=NEW."recipientId" FOR SHARE;
  IF source_office IS DISTINCT FROM NEW."officeId" OR r.version IS DISTINCT FROM NEW."issuerVersion" OR r.archived OR r."companyId" IS DISTINCT FROM NEW."companyId" OR NOT EXISTS(SELECT 1 FROM public."OfficeTaxRegistration" m JOIN public."BusinessOffice" o ON o."tenantId"=m."tenantId" AND o.id=m."officeId" JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" WHERE m."tenantId"=NEW."tenantId" AND m."officeId"=NEW."officeId" AND m."companyId"=NEW."companyId" AND m."registrationId"=NEW."issuerId" AND m.version=NEW."mappingVersion" AND NOT o.archived AND NOT c.archived) THEN RAISE EXCEPTION 'Tax preparation: issuing office, registration or mapping changed' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."CompanyTaxRegistrationRevision" WHERE "tenantId"=NEW."tenantId" AND "registrationId"=NEW."issuerId" AND version=NEW."issuerVersion" AND snapshot=NEW."issuerSnapshot") THEN RAISE EXCEPTION 'Tax preparation: issuer snapshot mismatch' USING ERRCODE='23514';END IF;
  IF jsonb_typeof(s->'participants'->'participants') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Tax preparation: save an explicit main customer first' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(s->'participants'->'participants') x WHERE x->>'role'='CUSTOMER')<>1 THEN RAISE EXCEPTION 'Tax preparation: exactly one saved main customer is required' USING ERRCODE='23514';END IF;
  SELECT x->'party' INTO party FROM jsonb_array_elements(coalesce(s->'participants'->'participants','[]'::jsonb)) x WHERE x->>'role'='CUSTOMER';
  IF p.version IS DISTINCT FROM NEW."recipientVersion" OR p.archived OR NOT ((party->>'kind'='PERSON' AND p."contactId"=party->>'id' AND EXISTS(SELECT 1 FROM public."CrmContact" WHERE "tenantId"=NEW."tenantId" AND id=p."contactId" AND NOT archived)) OR (party->>'kind'='BUSINESS' AND p."accountId"=party->>'id' AND EXISTS(SELECT 1 FROM public."CrmAccount" WHERE "tenantId"=NEW."tenantId" AND id=p."accountId" AND NOT archived))) IS TRUE THEN RAISE EXCEPTION 'Tax preparation: select the saved main customer identity' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."PartyTaxIdentityRevision" WHERE "tenantId"=NEW."tenantId" AND "identityId"=NEW."recipientId" AND version=NEW."recipientVersion" AND snapshot=NEW."recipientSnapshot") THEN RAISE EXCEPTION 'Tax preparation: recipient snapshot mismatch' USING ERRCODE='23514';END IF;
  IF NEW."proposedSupplyOn"<r."effectiveFrom" OR NEW."proposedSupplyOn">coalesce(r."effectiveTo",'infinity'::date) OR NEW."proposedSupplyOn"<p."effectiveFrom" OR NEW."proposedSupplyOn">coalesce(p."effectiveTo",'infinity'::date) THEN RAISE EXCEPTION 'Tax preparation: identity dates do not cover the proposed date' USING ERRCODE='23514';END IF;
  IF current_setting('app.rls_bypass',true) IS DISTINCT FROM 'on' AND NEW."createdBy" IS DISTINCT FROM current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Tax preparation: reviewer identity mismatch' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO review FROM public."QuotationTaxInputReview" WHERE "tenantId"=NEW."tenantId" AND id=NEW."reviewId";
  SELECT snapshot INTO s FROM public."CrmQuotationRevision" WHERE "tenantId"=review."tenantId" AND "quotationId"=review."quotationId" AND number=review.revision;
  SELECT * INTO profile FROM public."CompanyTaxProfile" WHERE "tenantId"=NEW."tenantId" AND id=NEW."profileId" FOR SHARE;
  SELECT snapshot INTO stored FROM public."CompanyTaxProfileVersion" WHERE "tenantId"=NEW."tenantId" AND "profileId"=NEW."profileId" AND version=NEW."profileVersion";
  IF review.id IS NULL OR NEW."lineIndex">=jsonb_array_length(s->'content'->'lines') OR profile.version IS DISTINCT FROM NEW."profileVersion" OR NOT profile.enabled OR profile."companyId" IS DISTINCT FROM review."companyId" OR stored IS DISTINCT FROM NEW."profileSnapshot" THEN RAISE EXCEPTION 'Tax preparation: choose current enabled profiles from the source company' USING ERRCODE='23514';END IF;
  IF (jsonb_array_length(stored->'variants')=0 AND NEW.variant<>'NONE') OR (jsonb_array_length(stored->'variants')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(stored->'variants') v WHERE v->>'key'=NEW.variant)) THEN RAISE EXCEPTION 'Tax preparation: unconfigured jurisdiction variant' USING ERRCODE='23514';END IF;
  PERFORM t.id FROM public."Tax" t JOIN public."CompanyTaxProfileRate" x ON x."tenantId"=t."tenantId" AND x."taxId"=t.id WHERE x."tenantId"=NEW."tenantId" AND x."profileId"=NEW."profileId" AND x."profileVersion"=NEW."profileVersion" ORDER BY t.id FOR SHARE OF t;
  IF EXISTS(SELECT 1 FROM public."CompanyTaxProfileRate" x JOIN public."Tax" t ON t."tenantId"=x."tenantId" AND t.id=x."taxId" WHERE x."tenantId"=NEW."tenantId" AND x."profileId"=NEW."profileId" AND x."profileVersion"=NEW."profileVersion" AND (NOT t."isActive" OR t.name<>x.name OR t.percent<>x.percent OR t."updatedAt"<>x."sourceUpdatedAt")) THEN RAISE EXCEPTION 'Tax preparation: publish a fresh reviewed profile after rate changes' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.quotation_tax_inputs_write() FROM PUBLIC;
CREATE TRIGGER quotation_tax_inputs_write BEFORE INSERT ON "QuotationTaxInputReview" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_write();
CREATE TRIGGER quotation_tax_inputs_write BEFORE INSERT ON "QuotationTaxInputLine" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_write();
CREATE FUNCTION app.quotation_tax_inputs_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE k text;expected integer;actual integer;
BEGIN
 k:=coalesce(to_jsonb(NEW)->>'reviewId',to_jsonb(NEW)->>'id');
 SELECT jsonb_array_length(v.snapshot->'content'->'lines') INTO expected FROM public."QuotationTaxInputReview" r JOIN public."CrmQuotationRevision" v ON v."tenantId"=r."tenantId" AND v."quotationId"=r."quotationId" AND v.number=r.revision WHERE r."tenantId"=NEW."tenantId" AND r.id=k;
 SELECT count(*) INTO actual FROM public."QuotationTaxInputLine" WHERE "tenantId"=NEW."tenantId" AND "reviewId"=k;
 IF expected IS NULL OR expected<1 OR actual<>expected THEN RAISE EXCEPTION 'Tax preparation: every source line needs immutable reviewed inputs' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.quotation_tax_inputs_proof() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER quotation_tax_inputs_proof AFTER INSERT ON "QuotationTaxInputReview" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_proof();
CREATE CONSTRAINT TRIGGER quotation_tax_inputs_proof AFTER INSERT ON "QuotationTaxInputLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_proof();
CREATE FUNCTION app.quotation_tax_acceptance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 PERFORM id FROM public."CrmQuotation" WHERE "tenantId"=NEW."tenantId" AND id=NEW."quotationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public."QuotationTaxInputReview" WHERE "tenantId"=NEW."tenantId" AND "quotationId"=NEW."quotationId" AND revision=NEW.revision) THEN RAISE EXCEPTION 'Tax preparation: tax-aware pricing approval is required before order acceptance' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.quotation_tax_acceptance_guard() FROM PUBLIC;
CREATE TRIGGER quotation_tax_acceptance_guard BEFORE INSERT ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_acceptance_guard();
ALTER TABLE "QuotationTaxInputReview" ENABLE ROW LEVEL SECURITY;ALTER TABLE "QuotationTaxInputReview" FORCE ROW LEVEL SECURITY;
ALTER TABLE "QuotationTaxInputLine" ENABLE ROW LEVEL SECURITY;ALTER TABLE "QuotationTaxInputLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "QuotationTaxInputReview" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY source_read ON "QuotationTaxInputReview" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR "quotationId" IN (SELECT id FROM "CrmQuotation" WHERE "tenantId"="QuotationTaxInputReview"."tenantId"));
CREATE POLICY source_insert ON "QuotationTaxInputReview" AS RESTRICTIVE FOR INSERT WITH CHECK(app.tax_configuration_admin("tenantId") AND app.record_sharing_allowed("tenantId",'quotations',"quotationId",nullif(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY tenant_isolation ON "QuotationTaxInputLine" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY source_read ON "QuotationTaxInputLine" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR "reviewId" IN (SELECT id FROM "QuotationTaxInputReview" WHERE "tenantId"="QuotationTaxInputLine"."tenantId"));
CREATE POLICY source_insert ON "QuotationTaxInputLine" AS RESTRICTIVE FOR INSERT WITH CHECK(app.tax_configuration_admin("tenantId") AND "reviewId" IN (SELECT id FROM "QuotationTaxInputReview" WHERE "tenantId"="QuotationTaxInputLine"."tenantId"));
DO $$ DECLARE who text;BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON "QuotationTaxInputReview","QuotationTaxInputLine" TO %I',who);END IF;END LOOP;END $$;
COMMIT;
