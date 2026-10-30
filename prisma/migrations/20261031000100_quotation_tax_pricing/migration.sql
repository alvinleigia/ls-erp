BEGIN;
CREATE TABLE "QuotationTaxPricingApproval" (
 id text PRIMARY KEY,"tenantId" text NOT NULL,"reviewId" text NOT NULL,agreement jsonb NOT NULL,"basisReference" text NOT NULL CHECK(length(btrim("basisReference")) BETWEEN 10 AND 1000),"createdBy" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","reviewId") REFERENCES "QuotationTaxInputReview"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE("tenantId",id),UNIQUE("tenantId","reviewId")
);
CREATE TABLE "SalesOrderTaxAcceptance" (
 "tenantId" text NOT NULL,"orderId" text NOT NULL,"approvalId" text NOT NULL,snapshot jsonb NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","orderId"),
 FOREIGN KEY("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","approvalId") REFERENCES "QuotationTaxPricingApproval"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Native exact proof uses the same largest-remainder / source-order tie policy
-- as platform/tax. Numeric operations never use binary floats.
CREATE FUNCTION app.tax_allocate_minor(total numeric,weights numeric[]) RETURNS numeric[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result numeric[];s numeric;remaining integer;i integer;
BEGIN
 IF total<0 OR trunc(total)<>total OR EXISTS(SELECT 1 FROM unnest(weights) x WHERE x<0) THEN RAISE EXCEPTION 'Tax preparation: invalid allocation';END IF;
 SELECT coalesce(sum(x),0) INTO s FROM unnest(weights) x;
 IF s=0 THEN IF total<>0 THEN RAISE EXCEPTION 'Tax preparation: positive allocation needs weights';END IF;RETURN array_fill(0::numeric,ARRAY[cardinality(weights)]);END IF;
 SELECT array_agg(floor(total*x/s) ORDER BY n) INTO result FROM unnest(weights) WITH ORDINALITY v(x,n);
 SELECT (total-sum(x))::integer INTO remaining FROM unnest(result) x;
 FOR i IN SELECT n::integer FROM unnest(weights) WITH ORDINALITY v(x,n) ORDER BY mod(total*x,s) DESC,n LOOP
  EXIT WHEN remaining=0;result[i]:=result[i]+1;remaining:=remaining-1;
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION app.quotation_tax_pricing_agreement(tid text,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s jsonb;review public."QuotationTaxInputReview"%ROWTYPE;l public."QuotationTaxInputLine"%ROWTYPE;amounts numeric[];discounts numeric[];amount numeric;discount numeric;net numeric;tax numeric;gross numeric;rates numeric[];shares numeric[];v jsonb;components jsonb;item jsonb;result jsonb:='[]';net_total numeric:=0;tax_total numeric:=0;gross_total numeric:=0;discount_total numeric;rate_total numeric;
BEGIN
 SELECT * INTO review FROM public."QuotationTaxInputReview" WHERE "tenantId"=tid AND id=rid;
 SELECT snapshot INTO s FROM public."CrmQuotationRevision" WHERE "tenantId"=tid AND "quotationId"=review."quotationId" AND number=review.revision;
 IF s IS NULL OR s->'content'->>'currency'<>'INR' OR jsonb_array_length(s->'content'->'charges')<>0 THEN RAISE EXCEPTION 'Tax preparation: pricing approval requires INR and explicitly classified charge-free source lines' USING ERRCODE='23514';END IF;
 SELECT array_agg((x->>'amount')::numeric*100 ORDER BY n) INTO amounts FROM jsonb_array_elements(s->'calculation'->'lines') WITH ORDINALITY a(x,n);
 discount_total:=(s->'calculation'->>'discount')::numeric*100;
 IF cardinality(amounts)<1 OR discount_total<0 OR trunc(discount_total)<>discount_total OR EXISTS(SELECT 1 FROM unnest(amounts) x WHERE x<0 OR trunc(x)<>x) OR discount_total>(SELECT sum(x) FROM unnest(amounts) x) THEN RAISE EXCEPTION 'Tax preparation: source precision or discount mismatch' USING ERRCODE='23514';END IF;
 discounts:=app.tax_allocate_minor(discount_total,amounts);
 IF (SELECT count(*) FROM public."QuotationTaxInputLine" WHERE "tenantId"=tid AND "reviewId"=rid)<>cardinality(amounts) THEN RAISE EXCEPTION 'Tax preparation: every source line needs reviewed inputs' USING ERRCODE='23514';END IF;
 FOR l IN SELECT * FROM public."QuotationTaxInputLine" WHERE "tenantId"=tid AND "reviewId"=rid ORDER BY "lineIndex" LOOP
  amount:=amounts[l."lineIndex"+1];discount:=discounts[l."lineIndex"+1];
  SELECT x INTO v FROM jsonb_array_elements(l."profileSnapshot"->'variants') x WHERE x->>'key'=l.variant;
  SELECT coalesce(array_agg((x->>'percent')::numeric ORDER BY x->>'code' COLLATE "C"),'{}'::numeric[]),coalesce(sum((x->>'percent')::numeric),0) INTO rates,rate_total FROM jsonb_array_elements(coalesce(v->'components','[]'::jsonb)) x;
  IF l."profileSnapshot"->>'priceBasis'='INCLUSIVE' THEN
   net:=round((amount-discount)*100/(100+rate_total));tax:=amount-discount-net;shares:=app.tax_allocate_minor(tax,rates);
  ELSE
   net:=amount-discount;SELECT coalesce(array_agg(round(net*x/100) ORDER BY n),'{}'::numeric[]) INTO shares FROM unnest(rates) WITH ORDINALITY z(x,n);SELECT coalesce(sum(x),0) INTO tax FROM unnest(shares) x;
  END IF;
  gross:=net+tax;components:='[]'::jsonb;
  FOR item IN SELECT x||jsonb_build_object('amountMinor',shares[n::integer]) FROM (SELECT x,row_number() OVER(ORDER BY x->>'code' COLLATE "C") n FROM jsonb_array_elements(coalesce(v->'components','[]'::jsonb)) x) a LOOP
   components:=components||jsonb_build_array(jsonb_build_object('code',item->>'code','percent',item->>'percent','amountMinor',item->'amountMinor'));
  END LOOP;
  result:=result||jsonb_build_array(jsonb_build_object('key',l."lineIndex"::text,'amountMinor',amount,'discountMinor',discount,'priceBasis',l."profileSnapshot"->>'priceBasis','netMinor',net,'taxMinor',tax,'grossMinor',gross,'components',components));net_total:=net_total+net;tax_total:=tax_total+tax;gross_total:=gross_total+gross;
 END LOOP;
 IF greatest(net_total,tax_total,gross_total,discount_total)>9007199254740991 THEN RAISE EXCEPTION 'Tax preparation: agreement exceeds supported precision' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('format',1,'rounding','LINE_EXACT_V1','currency','INR','minorDigits',2,'lines',result,'netMinor',net_total,'taxMinor',tax_total,'grossMinor',gross_total,'discountMinor',discount_total);
END $$;
REVOKE ALL ON FUNCTION app.quotation_tax_pricing_agreement(text,text) FROM PUBLIC;
CREATE FUNCTION app.quotation_tax_pricing_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r public."QuotationTaxInputReview"%ROWTYPE;q public."CrmQuotation"%ROWTYPE;s jsonb;expected jsonb;
BEGIN
 SELECT * INTO r FROM public."QuotationTaxInputReview" WHERE "tenantId"=NEW."tenantId" AND id=NEW."reviewId";
 SELECT * INTO q FROM public."CrmQuotation" WHERE "tenantId"=r."tenantId" AND id=r."quotationId" FOR UPDATE;
 SELECT snapshot INTO s FROM public."CrmQuotationRevision" WHERE "tenantId"=r."tenantId" AND "quotationId"=r."quotationId" AND number=r.revision;
 IF q.id IS NULL OR q.version<>r.revision OR EXISTS(SELECT 1 FROM public."SalesOrder" WHERE "tenantId"=r."tenantId" AND "quotationId"=r."quotationId" AND revision=r.revision) THEN RAISE EXCEPTION 'Tax preparation: approve a current revision that has never been ordered' USING ERRCODE='23514';END IF;
 -- Preparation freezes history; approval must explicitly reject stale current
 -- issuer/recipient/profile facts rather than certifying those old facts anew.
 PERFORM id FROM public."CompanyTaxRegistration" WHERE "tenantId"=r."tenantId" AND id=r."issuerId" FOR SHARE;
 PERFORM id FROM public."PartyTaxIdentity" WHERE "tenantId"=r."tenantId" AND id=r."recipientId" FOR SHARE;
 PERFORM "officeId" FROM public."OfficeTaxRegistration" WHERE "tenantId"=r."tenantId" AND "officeId"=r."officeId" FOR SHARE;
 PERFORM id FROM public."BusinessOffice" WHERE "tenantId"=r."tenantId" AND id=r."officeId" FOR SHARE;
 PERFORM id FROM public."BusinessCompany" WHERE "tenantId"=r."tenantId" AND id=r."companyId" FOR SHARE;
 PERFORM c.id FROM public."CrmContact" c JOIN public."PartyTaxIdentity" p ON p."tenantId"=c."tenantId" AND p."contactId"=c.id WHERE p."tenantId"=r."tenantId" AND p.id=r."recipientId" FOR SHARE OF c;
 PERFORM c.id FROM public."CrmAccount" c JOIN public."PartyTaxIdentity" p ON p."tenantId"=c."tenantId" AND p."accountId"=c.id WHERE p."tenantId"=r."tenantId" AND p.id=r."recipientId" FOR SHARE OF c;
 PERFORM p.id FROM public."CompanyTaxProfile" p JOIN public."QuotationTaxInputLine" l ON l."tenantId"=p."tenantId" AND l."profileId"=p.id WHERE l."tenantId"=r."tenantId" AND l."reviewId"=r.id ORDER BY p.id FOR SHARE OF p;
 PERFORM t.id FROM public."Tax" t JOIN public."CompanyTaxProfileRate" x ON x."tenantId"=t."tenantId" AND x."taxId"=t.id JOIN public."QuotationTaxInputLine" l ON l."tenantId"=x."tenantId" AND l."profileId"=x."profileId" AND l."profileVersion"=x."profileVersion" WHERE l."tenantId"=r."tenantId" AND l."reviewId"=r.id ORDER BY t.id FOR SHARE OF t;
 IF NOT EXISTS(SELECT 1 FROM public."CompanyTaxRegistration" i JOIN public."OfficeTaxRegistration" m ON m."tenantId"=i."tenantId" AND m."registrationId"=i.id JOIN public."BusinessOffice" o ON o."tenantId"=m."tenantId" AND o.id=m."officeId" JOIN public."BusinessCompany" c ON c."tenantId"=o."tenantId" AND c.id=o."companyId" WHERE i."tenantId"=r."tenantId" AND i.id=r."issuerId" AND i.version=r."issuerVersion" AND NOT i.archived AND m."officeId"=r."officeId" AND m.version=r."mappingVersion" AND NOT o.archived AND NOT c.archived)
 OR NOT EXISTS(SELECT 1 FROM public."PartyTaxIdentity" p WHERE p."tenantId"=r."tenantId" AND p.id=r."recipientId" AND p.version=r."recipientVersion" AND NOT p.archived AND (p."contactId" IS NULL OR EXISTS(SELECT 1 FROM public."CrmContact" WHERE "tenantId"=r."tenantId" AND id=p."contactId" AND NOT archived)) AND (p."accountId" IS NULL OR EXISTS(SELECT 1 FROM public."CrmAccount" WHERE "tenantId"=r."tenantId" AND id=p."accountId" AND NOT archived)))
 OR EXISTS(SELECT 1 FROM public."QuotationTaxInputLine" l JOIN public."CompanyTaxProfile" p ON p."tenantId"=l."tenantId" AND p.id=l."profileId" WHERE l."tenantId"=r."tenantId" AND l."reviewId"=r.id AND (NOT p.enabled OR p.version<>l."profileVersion"))
 OR EXISTS(SELECT 1 FROM public."QuotationTaxInputLine" l JOIN public."CompanyTaxProfileRate" x ON x."tenantId"=l."tenantId" AND x."profileId"=l."profileId" AND x."profileVersion"=l."profileVersion" JOIN public."Tax" t ON t."tenantId"=x."tenantId" AND t.id=x."taxId" WHERE l."tenantId"=r."tenantId" AND l."reviewId"=r.id AND (NOT t."isActive" OR t.name<>x.name OR t.percent<>x.percent OR t."updatedAt"<>x."sourceUpdatedAt")) THEN RAISE EXCEPTION 'Tax preparation: tax configuration or customer identity changed; prepare a new reviewed revision' USING ERRCODE='23514';END IF;
 expected:=app.quotation_tax_pricing_agreement(r."tenantId",r.id);
 IF NEW.agreement IS DISTINCT FROM expected OR (expected->>'grossMinor')::numeric IS DISTINCT FROM (s->'calculation'->>'consideration')::numeric*100 THEN RAISE EXCEPTION 'Tax preparation: approved tax agreement must exactly reconcile the unchanged quoted price' USING ERRCODE='23514';END IF;
 IF current_setting('app.rls_bypass',true) IS DISTINCT FROM 'on' AND NEW."createdBy" IS DISTINCT FROM current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Tax preparation: pricing reviewer identity mismatch' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.quotation_tax_pricing_write() FROM PUBLIC;
CREATE TRIGGER quotation_tax_pricing_write BEFORE INSERT ON "QuotationTaxPricingApproval" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_pricing_write();
CREATE TRIGGER quotation_tax_pricing_immutable BEFORE UPDATE OR DELETE ON "QuotationTaxPricingApproval" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_immutable();
CREATE TRIGGER sales_order_tax_immutable BEFORE UPDATE OR DELETE ON "SalesOrderTaxAcceptance" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_immutable();
-- Only this P13B2 guard is replaced; all commercial/source/office guards remain.
CREATE OR REPLACE FUNCTION app.quotation_tax_acceptance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r public."QuotationTaxInputReview"%ROWTYPE;p public."QuotationTaxPricingApproval"%ROWTYPE;s jsonb;
BEGIN
 PERFORM id FROM public."CrmQuotation" WHERE "tenantId"=NEW."tenantId" AND id=NEW."quotationId" FOR UPDATE;
 SELECT * INTO r FROM public."QuotationTaxInputReview" WHERE "tenantId"=NEW."tenantId" AND "quotationId"=NEW."quotationId" AND revision=NEW.revision;
 IF r.id IS NOT NULL THEN
  SELECT * INTO p FROM public."QuotationTaxPricingApproval" WHERE "tenantId"=r."tenantId" AND "reviewId"=r.id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Tax preparation: tax-aware pricing approval is required before order acceptance' USING ERRCODE='23514';END IF;
  SELECT snapshot INTO s FROM public."CrmQuotationRevision" WHERE "tenantId"=r."tenantId" AND "quotationId"=r."quotationId" AND number=r.revision;
  IF NEW.snapshot IS DISTINCT FROM s OR NEW.title IS DISTINCT FROM s->'content'->>'title' OR NEW."customerName" IS DISTINCT FROM s->'customer'->>'name' OR NEW.currency IS DISTINCT FROM s->'content'->>'currency' OR NEW.consideration IS DISTINCT FROM (s->'calculation'->>'consideration')::numeric THEN RAISE EXCEPTION 'Tax preparation: order must retain the approved source prices and snapshot' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION app.sales_order_tax_snapshot(tid text,pid text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('format',1,'reviewId',r.id,'approvalId',p.id,'agreement',p.agreement,'basisReference',p."basisReference",'reviewedBy',p."createdBy",'reviewedAt',p."createdAt",'issuer',r."issuerSnapshot",'recipient',r."recipientSnapshot",'proposedSupplyOn',r."proposedSupplyOn",'lines',(SELECT jsonb_agg(to_jsonb(l)-ARRAY['tenantId','reviewId'] ORDER BY l."lineIndex") FROM public."QuotationTaxInputLine" l WHERE l."tenantId"=r."tenantId" AND l."reviewId"=r.id)) FROM public."QuotationTaxPricingApproval" p JOIN public."QuotationTaxInputReview" r ON r."tenantId"=p."tenantId" AND r.id=p."reviewId" WHERE p."tenantId"=tid AND p.id=pid
$$;
REVOKE ALL ON FUNCTION app.sales_order_tax_snapshot(text,text) FROM PUBLIC;
CREATE FUNCTION app.sales_order_tax_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 IF NEW.snapshot IS DISTINCT FROM app.sales_order_tax_snapshot(NEW."tenantId",NEW."approvalId") OR NOT EXISTS(SELECT 1 FROM public."SalesOrder" s JOIN public."QuotationTaxInputReview" r ON r."tenantId"=s."tenantId" AND r."quotationId"=s."quotationId" AND r.revision=s.revision JOIN public."QuotationTaxPricingApproval" p ON p."tenantId"=r."tenantId" AND p."reviewId"=r.id WHERE s."tenantId"=NEW."tenantId" AND s.id=NEW."orderId" AND p.id=NEW."approvalId") THEN RAISE EXCEPTION 'Tax preparation: accepted tax evidence must match the native approved source' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.sales_order_tax_proof() FROM PUBLIC;
CREATE TRIGGER sales_order_tax_proof BEFORE INSERT ON "SalesOrderTaxAcceptance" FOR EACH ROW EXECUTE FUNCTION app.sales_order_tax_proof();
CREATE FUNCTION app.freeze_sales_order_tax() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r public."QuotationTaxInputReview"%ROWTYPE;p public."QuotationTaxPricingApproval"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public."QuotationTaxInputReview" WHERE "tenantId"=NEW."tenantId" AND "quotationId"=NEW."quotationId" AND revision=NEW.revision;
 IF r.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO STRICT p FROM public."QuotationTaxPricingApproval" WHERE "tenantId"=r."tenantId" AND "reviewId"=r.id;
 INSERT INTO public."SalesOrderTaxAcceptance"("tenantId","orderId","approvalId",snapshot) VALUES(NEW."tenantId",NEW.id,p.id,app.sales_order_tax_snapshot(NEW."tenantId",p.id));RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.freeze_sales_order_tax() FROM PUBLIC;
CREATE TRIGGER freeze_sales_order_tax AFTER INSERT ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.freeze_sales_order_tax();
CREATE FUNCTION app.tax_order_commercial_invoice_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId") THEN RAISE EXCEPTION 'Billing: Tax-aware orders require native tax invoice allocations; commercial invoice creation is blocked.' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_order_commercial_invoice_guard() FROM PUBLIC;
CREATE TRIGGER tax_order_commercial_invoice_guard BEFORE INSERT ON "CustomerInvoice" FOR EACH ROW EXECUTE FUNCTION app.tax_order_commercial_invoice_guard();
ALTER TABLE "QuotationTaxPricingApproval" ENABLE ROW LEVEL SECURITY;ALTER TABLE "QuotationTaxPricingApproval" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SalesOrderTaxAcceptance" ENABLE ROW LEVEL SECURITY;ALTER TABLE "SalesOrderTaxAcceptance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "QuotationTaxPricingApproval" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY source_read ON "QuotationTaxPricingApproval" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR "reviewId" IN (SELECT id FROM "QuotationTaxInputReview" WHERE "tenantId"="QuotationTaxPricingApproval"."tenantId"));
CREATE POLICY source_insert ON "QuotationTaxPricingApproval" AS RESTRICTIVE FOR INSERT WITH CHECK(app.tax_configuration_admin("tenantId") AND "reviewId" IN (SELECT id FROM "QuotationTaxInputReview" WHERE "tenantId"="QuotationTaxPricingApproval"."tenantId" AND app.record_sharing_allowed("tenantId",'quotations',"quotationId",nullif(current_setting('app.actor_id',true),''),'EDIT')));
CREATE POLICY tenant_isolation ON "SalesOrderTaxAcceptance" FOR SELECT USING(app.tenant_match("tenantId"));
CREATE POLICY source_read ON "SalesOrderTaxAcceptance" AS RESTRICTIVE FOR SELECT USING(current_setting('app.rls_bypass',true)='on' OR "orderId" IN (SELECT id FROM "SalesOrder" WHERE "tenantId"="SalesOrderTaxAcceptance"."tenantId"));
DO $$ DECLARE who text;BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT,INSERT ON "QuotationTaxPricingApproval" TO %I',who);EXECUTE format('GRANT SELECT ON "SalesOrderTaxAcceptance" TO %I',who);END IF;END LOOP;END $$;
COMMIT;
