BEGIN;
-- Item defaults inherit the existing catalog row's tenant, project and office ACL.
ALTER TABLE "CatalogItem" ADD COLUMN charges jsonb NOT NULL DEFAULT '[]';
CREATE FUNCTION app.valid_item_charges(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb;names text[]:='{}';label text;
BEGIN
 IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>10 OR octet_length(v::text)>65536 THEN RETURN false;END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(c)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k<>ALL(ARRAY['label','group','kind','value','included','due'])) THEN RETURN false;END IF;
  IF jsonb_typeof(c->'label') IS DISTINCT FROM 'string' OR length(btrim(c->>'label')) NOT BETWEEN 1 AND 150 OR jsonb_typeof(c->'kind') IS DISTINCT FROM 'string' OR c->>'kind' NOT IN ('FIXED','PERCENT') OR jsonb_typeof(c->'value') IS DISTINCT FROM 'string' OR (c->>'value')!~'^\d{1,12}(\.\d{1,4})?$' OR jsonb_typeof(c->'included') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  IF c->>'kind'='PERCENT' AND (c->>'value')::numeric>100 THEN RETURN false;END IF;
  IF c?'group' AND (jsonb_typeof(c->'group')<>'string' OR length(c->>'group')>100) OR c?'due' AND (jsonb_typeof(c->'due')<>'string' OR length(c->>'due')>500) THEN RETURN false;END IF;
  label:=lower(btrim(c->>'label'));IF label=ANY(names) THEN RETURN false;END IF;names:=array_append(names,label);
 END LOOP;
 RETURN true;
END $$;
ALTER TABLE "CatalogItem" ADD CONSTRAINT catalog_item_charges_valid CHECK(app.valid_item_charges(charges));
ALTER TABLE "CatalogImport" ALTER COLUMN "templateVersion" SET DEFAULT 2;
ALTER TABLE "CatalogImport" DROP CONSTRAINT "CatalogImport_templateVersion_check";
ALTER TABLE "CatalogImport" ADD CONSTRAINT "CatalogImport_templateVersion_check" CHECK("templateVersion" IN (1,2));

-- Keep each item's own extra fees on that line. Shared charges and discounts
-- retain cumulative minor-unit allocation; old snapshots have zero item fees.
CREATE OR REPLACE FUNCTION app.invoice_billing_basis(s jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH lines AS (SELECT value,ordinality-1 idx,(value->>'amount')::numeric+coalesce((value->>'itemIncluded')::numeric,0) weight,coalesce((value->>'itemExtra')::numeric,0) direct FROM jsonb_array_elements(s->'calculation'->'lines') WITH ORDINALITY),
 weights AS (SELECT *,CASE WHEN sum(weight) OVER()>0 THEN weight ELSE 1 END w FROM lines),
 running AS (SELECT *,sum(w) OVER(ORDER BY idx) running,sum(w) OVER() total,sum(direct) OVER() extras FROM weights),
 allocated AS (SELECT *,round(((s->'calculation'->>'totalKnown')::numeric-extras)*running/total,length(split_part(s->'calculation'->>'totalKnown','.',2))) edge FROM running)
 SELECT coalesce(jsonb_agg(jsonb_build_object('lineIndex',idx,'description',value->>'description','unit',value->>'unit','sourceQuantity',value->>'quantity','quantity',value->>'quantity','amount',(direct+edge-coalesce(lag_edge,0))::text) ORDER BY idx),'[]'::jsonb)
 FROM (SELECT *,lag(edge) OVER(ORDER BY idx) lag_edge FROM allocated) q
$$;

-- Native GST pricing continues to reject unclassified commercial charges.
CREATE OR REPLACE FUNCTION app.quotation_tax_pricing_agreement(tid text,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s jsonb;review public."QuotationTaxInputReview"%ROWTYPE;l public."QuotationTaxInputLine"%ROWTYPE;amounts numeric[];discounts numeric[];amount numeric;discount numeric;net numeric;tax numeric;gross numeric;rates numeric[];shares numeric[];v jsonb;components jsonb;item jsonb;result jsonb:='[]';net_total numeric:=0;tax_total numeric:=0;gross_total numeric:=0;discount_total numeric;rate_total numeric;
BEGIN
 SELECT * INTO review FROM public."QuotationTaxInputReview" WHERE "tenantId"=tid AND id=rid;
 SELECT snapshot INTO s FROM public."CrmQuotationRevision" WHERE "tenantId"=tid AND "quotationId"=review."quotationId" AND number=review.revision;
 IF s IS NULL OR s->'content'->>'currency'<>'INR' OR (jsonb_array_length(s->'content'->'charges')<>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'content'->'lines') l WHERE jsonb_array_length(coalesce(l->'charges','[]'::jsonb))>0)) THEN RAISE EXCEPTION 'Tax preparation: pricing approval requires INR and explicitly classified charge-free source lines' USING ERRCODE='23514';END IF;
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

COMMIT;
