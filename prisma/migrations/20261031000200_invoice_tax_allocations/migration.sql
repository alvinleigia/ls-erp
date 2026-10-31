BEGIN;
CREATE TABLE "CustomerInvoiceTaxSnapshot" (
 "tenantId" text NOT NULL,"invoiceId" text NOT NULL,version integer NOT NULL,"orderId" text NOT NULL,snapshot jsonb NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","invoiceId",version),
 FOREIGN KEY("tenantId","invoiceId",version) REFERENCES "CustomerInvoiceEvent"("tenantId","invoiceId",version) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY("tenantId","orderId") REFERENCES "SalesOrderTaxAcceptance"("tenantId","orderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CustomerCreditTaxSnapshot" (
 "tenantId" text NOT NULL,"invoiceId" text NOT NULL,"invoiceVersion" integer NOT NULL,snapshot jsonb NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","invoiceId"),
 FOREIGN KEY("tenantId","invoiceId") REFERENCES "CustomerCreditNote"("tenantId","invoiceId") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","invoiceId","invoiceVersion") REFERENCES "CustomerInvoiceTaxSnapshot"("tenantId","invoiceId",version) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION app.invoice_billing_order_basis(t text,k text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s jsonb;a jsonb;result jsonb;
BEGIN
 SELECT snapshot INTO s FROM public."SalesOrder" WHERE "tenantId"=t AND id=k;
 SELECT snapshot->'agreement' INTO a FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=t AND "orderId"=k;
 IF a IS NULL THEN RETURN app.invoice_billing_basis(s);END IF;
 SELECT jsonb_agg(jsonb_build_object('lineIndex',(l->>'key')::integer,'description',q->>'description','unit',q->>'unit','sourceQuantity',q->>'quantity','quantity',q->>'quantity','amount',round((l->>'grossMinor')::numeric/100,2)::text) ORDER BY (l->>'key')::integer) INTO result FROM jsonb_array_elements(a->'lines') l CROSS JOIN LATERAL (SELECT s->'calculation'->'lines'->((l->>'key')::integer) q) x;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.invoice_billing_order_basis(text,text) FROM PUBLIC;
CREATE FUNCTION app.allocate_invoice_tax(t text,k text,skip text,bill jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE accepted public."SalesOrderTaxAcceptance"%ROWTYPE;agreement jsonb;f jsonb;a jsonb;c jsonb;used numeric;used_gross numeric;net_remaining numeric;remaining numeric;weights numeric[];shares numeric[];components jsonb;lines jsonb:='[]';part numeric;net_total numeric:=0;tax_total numeric:=0;gross_total numeric:=0;i integer;
BEGIN
 SELECT * INTO accepted FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=t AND "orderId"=k;
 IF accepted."orderId" IS NULL THEN RETURN NULL;END IF;agreement:=accepted.snapshot->'agreement';
 IF agreement->>'currency'<>'INR' OR agreement->>'minorDigits'<>'2' OR agreement->>'rounding'<>'LINE_EXACT_V1' THEN RAISE EXCEPTION 'Billing: Unsupported accepted tax calculation policy' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public."CustomerInvoice" x WHERE x."tenantId"=t AND x."orderId"=k AND x.id<>skip AND x.status IN ('DRAFT','POSTED') AND (x.billing->'tax'->>'approvalId' IS DISTINCT FROM accepted."approvalId" OR x.billing->'tax'->>'policy' IS DISTINCT FROM 'REMAINING_BALANCE_V1')) THEN RAISE EXCEPTION 'Billing: Active invoices must retain their accepted tax agreement' USING ERRCODE='P0001';END IF;
 FOR a IN SELECT * FROM jsonb_array_elements(bill->'allocations') LOOP
  SELECT l INTO f FROM jsonb_array_elements(agreement->'lines') l WHERE l->>'key'=a->>'lineIndex';
  IF f IS NULL THEN RAISE EXCEPTION 'Billing: Billed line is not in the accepted tax agreement' USING ERRCODE='P0001';END IF;
  SELECT coalesce(sum((l->>'netMinor')::numeric),0),coalesce(sum((l->>'grossMinor')::numeric),0) INTO used,used_gross FROM public."CustomerInvoice" x CROSS JOIN LATERAL jsonb_array_elements(x.billing->'tax'->'lines') l WHERE x."tenantId"=t AND x."orderId"=k AND x.id<>skip AND x.status IN ('DRAFT','POSTED') AND l->>'key'=f->>'key';
  net_remaining:=(f->>'netMinor')::numeric-used;weights:=ARRAY[net_remaining];
  FOR c IN SELECT * FROM jsonb_array_elements(f->'components') LOOP
   SELECT coalesce(sum((p->>'amountMinor')::numeric),0) INTO used FROM public."CustomerInvoice" x CROSS JOIN LATERAL jsonb_array_elements(x.billing->'tax'->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'components') p WHERE x."tenantId"=t AND x."orderId"=k AND x.id<>skip AND x.status IN ('DRAFT','POSTED') AND l->>'key'=f->>'key' AND p->>'code'=c->>'code';
   weights:=array_append(weights,(c->>'amountMinor')::numeric-used);
  END LOOP;
  SELECT sum(w) INTO remaining FROM unnest(weights) w;part:=(a->>'amount')::numeric*100;
  IF net_remaining<0 OR EXISTS(SELECT 1 FROM unnest(weights) w WHERE w<0) OR remaining<>(f->>'grossMinor')::numeric-used_gross OR part<0 OR trunc(part)<>part OR part>remaining THEN RAISE EXCEPTION 'Billing: Tax allocation exceeds remaining frozen component balances' USING ERRCODE='P0001';END IF;
  shares:=app.tax_allocate_minor(part,weights);components:='[]';i:=2;
  FOR c IN SELECT * FROM jsonb_array_elements(f->'components') LOOP components:=components||jsonb_build_array(jsonb_build_object('code',c->>'code','amountMinor',shares[i]));i:=i+1;END LOOP;
  lines:=lines||jsonb_build_array(jsonb_build_object('key',f->>'key','netMinor',shares[1],'taxMinor',part-shares[1],'grossMinor',part,'components',components));net_total:=net_total+shares[1];tax_total:=tax_total+part-shares[1];gross_total:=gross_total+part;
 END LOOP;
 IF gross_total<>(bill->>'amount')::numeric*100 THEN RAISE EXCEPTION 'Billing: Frozen tax gross must equal the billed amount' USING ERRCODE='P0001';END IF;
 RETURN jsonb_build_object('format',1,'policy','REMAINING_BALANCE_V1','orderId',k,'approvalId',accepted."approvalId",'currency',agreement->>'currency','minorDigits',2,'netMinor',net_total,'taxMinor',tax_total,'grossMinor',gross_total,'lines',lines);
END $$;
REVOKE ALL ON FUNCTION app.allocate_invoice_tax(text,text,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.invoice_billing_capacity(t text,k text,skip text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s public."SalesOrder"%ROWTYPE;basis jsonb;lines jsonb;milestones jsonb;posted numeric;reserved numeric;credited numeric;total numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.document_source_issuer(t,k)) THEN RAISE EXCEPTION 'Billing: Source order unavailable' USING ERRCODE='P0001';END IF;
 SELECT * INTO s FROM public."SalesOrder" WHERE "tenantId"=t AND id=k;
 basis:=app.invoice_billing_order_basis(t,k);total:=(s.snapshot->'calculation'->>'totalKnown')::numeric;
 SELECT coalesce(sum((billing->>'amount')::numeric) FILTER(WHERE status='POSTED'),0),coalesce(sum((billing->>'amount')::numeric) FILTER(WHERE status='DRAFT'),0),coalesce(sum((billing->>'amount')::numeric) FILTER(WHERE status='CREDITED'),0)
 INTO posted,reserved,credited FROM public."CustomerInvoice" WHERE "tenantId"=t AND "orderId"=k AND id<>skip;
 SELECT jsonb_agg(b||jsonb_build_object('amount',((b->>'amount')::numeric-coalesce(u.amount,0))::text,'quantity',((b->>'quantity')::numeric-coalesce(u.quantity,0))::text) ORDER BY (b->>'lineIndex')::integer) INTO lines
 FROM jsonb_array_elements(basis) b LEFT JOIN LATERAL (
 SELECT sum((a->>'amount')::numeric) amount,sum((a->>'quantity')::numeric) quantity FROM public."CustomerInvoice" i CROSS JOIN LATERAL jsonb_array_elements(i.billing->'allocations') a
 WHERE i."tenantId"=t AND i."orderId"=k AND i.id<>skip AND i.status IN ('DRAFT','POSTED') AND a->>'lineIndex'=b->>'lineIndex') u ON true;
 SELECT coalesce(jsonb_agg(jsonb_build_object('position',p.position,'label',p.label,'amount',p.amount::text,'remaining',greatest(0,p.amount-coalesce(u.amount,0))::text) ORDER BY p.position),'[]'::jsonb) INTO milestones
 FROM public."OrderReceivableLine" p LEFT JOIN LATERAL (
 SELECT sum((i.billing->>'amount')::numeric) amount FROM public."CustomerInvoice" i WHERE i."tenantId"=t AND i."orderId"=k AND i.id<>skip AND i.status IN ('DRAFT','POSTED') AND i.billing->'request'->>'mode'='MILESTONE' AND (i.billing->'request'->>'position')::integer=p.position) u ON true
 WHERE p."tenantId"=t AND p."orderId"=k;
 RETURN jsonb_build_object('taxAware',EXISTS(SELECT 1 FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=t AND "orderId"=k),'currency',s.currency,'customer',s.snapshot->'customer'->>'name','orderReference',s.reference,'contractTotal',total::text,'posted',posted::text,'credited',credited::text,'reserved',reserved::text,'unbilled',(total-posted)::text,'available',(total-posted-reserved)::text,'lines',coalesce(lines,'[]'::jsonb),'milestones',milestones);
END $$;

CREATE OR REPLACE FUNCTION app.allocate_invoice_billing(t text,k text,skip text,req jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE c jsonb;b jsonb;allocations jsonb:='[]';r jsonb;mode text:=req->>'mode';desired numeric:=0;available numeric;part numeric;q numeric;running numeric:=0;allocated numeric:=0;edge numeric;digits integer;value numeric;bill jsonb;tax jsonb;
BEGIN
 IF jsonb_typeof(req)<>'object' OR req-ARRAY['mode','label','value','position','lines']<>'{}'::jsonb OR length(coalesce(req->>'label',''))>200 OR mode NOT IN ('FULL','BALANCE','AMOUNT','PERCENT','MILESTONE','LINES') THEN RAISE EXCEPTION 'Billing: Invalid billing selection' USING ERRCODE='P0001';END IF;
 c:=app.invoice_billing_capacity(t,k,skip);available:=(c->>'available')::numeric;
 SELECT length(split_part(snapshot->'calculation'->>'totalKnown','.',2)) INTO digits FROM public."SalesOrder" WHERE "tenantId"=t AND id=k;
 IF mode='FULL' THEN desired:=(c->>'contractTotal')::numeric;
 ELSIF mode='BALANCE' THEN desired:=available;
 ELSIF mode IN ('AMOUNT','PERCENT') THEN
  IF coalesce(req->>'value','')!~'^\d{1,12}(\.\d{1,12})?$' THEN RAISE EXCEPTION 'Billing: Enter a valid positive amount or percentage' USING ERRCODE='P0001';END IF;value:=(req->>'value')::numeric;
  IF mode='PERCENT' THEN IF value<=0 OR value>100 THEN RAISE EXCEPTION 'Billing: Percentage must be greater than zero and at most 100' USING ERRCODE='P0001';END IF;desired:=round((c->>'contractTotal')::numeric*value/100,digits);ELSE desired:=value;END IF;
 ELSIF mode='MILESTONE' THEN
  SELECT (m->>'remaining')::numeric INTO desired FROM jsonb_array_elements(c->'milestones') m WHERE m->>'position'=req->>'position';
  IF desired IS NULL THEN RAISE EXCEPTION 'Billing: Open receivables and choose an accepted payment-plan milestone' USING ERRCODE='P0001';END IF;
 ELSE
  IF jsonb_typeof(req->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(req->'lines') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT x->>'lineIndex') FROM jsonb_array_elements(req->'lines') x)<>jsonb_array_length(req->'lines') THEN RAISE EXCEPTION 'Billing: Choose each source line once' USING ERRCODE='P0001';END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(req->'lines') LOOP
   SELECT * INTO b FROM jsonb_array_elements(c->'lines') x WHERE x->>'lineIndex'=r->>'lineIndex';
   IF b IS NULL OR coalesce(r->>'quantity','')!~'^\d{1,12}(\.\d{1,12})?$' THEN RAISE EXCEPTION 'Billing: Choose a valid source line and quantity' USING ERRCODE='P0001';END IF;q:=(r->>'quantity')::numeric;
   IF q<=0 OR q>(b->>'quantity')::numeric THEN RAISE EXCEPTION 'Billing: Quantity exceeds the remaining unbilled quantity' USING ERRCODE='P0001';END IF;
   part:=CASE WHEN q=(b->>'quantity')::numeric THEN (b->>'amount')::numeric ELSE round((b->>'amount')::numeric*q/(b->>'quantity')::numeric,digits) END;
   IF part=0 AND (b->>'amount')::numeric>0 THEN RAISE EXCEPTION 'Billing: This quantity is too small for the currency precision' USING ERRCODE='P0001';END IF;
   desired:=desired+part;allocations:=allocations||jsonb_build_array(jsonb_build_object('lineIndex',(b->>'lineIndex')::integer,'quantity',q::text,'amount',part::text));
  END LOOP;
 END IF;
 IF desired IS NULL OR desired<=0 OR desired>available OR desired<>round(desired,digits) THEN RAISE EXCEPTION 'Billing: Amount exceeds available order value, is zero, or has unsupported currency precision. Refresh the billing statement' USING ERRCODE='P0001';END IF;
 IF mode<>'LINES' THEN
  FOR b IN SELECT * FROM jsonb_array_elements(c->'lines') LOOP
   running:=running+(b->>'amount')::numeric;edge:=round(desired*running/available,digits);part:=edge-allocated;allocated:=edge;
   q:=CASE WHEN part=(b->>'amount')::numeric AND (part>0 OR mode IN ('FULL','BALANCE')) THEN (b->>'quantity')::numeric WHEN part>0 THEN least((b->>'quantity')::numeric,greatest(0.000000000000000000000001,round((b->>'quantity')::numeric*part/(b->>'amount')::numeric,24))) ELSE 0 END;
   IF part>0 OR q>0 THEN allocations:=allocations||jsonb_build_array(jsonb_build_object('lineIndex',(b->>'lineIndex')::integer,'quantity',q::text,'amount',part::text));END IF;
  END LOOP;
 END IF;
 bill:=jsonb_build_object('format',1,'request',req,'amount',desired::text,'allocations',allocations);tax:=app.allocate_invoice_tax(t,k,skip,bill);RETURN CASE WHEN tax IS NULL THEN bill ELSE bill||jsonb_build_object('tax',tax) END;
END $$;

CREATE OR REPLACE FUNCTION app.commercial_invoice_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s public."SalesOrder"%ROWTYPE; c jsonb; o jsonb; a public."OrderReceivable"%ROWTYPE; day date;accepted jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 SELECT company,office INTO c,o FROM app.document_source_issuer(NEW."tenantId",NEW."orderId");
 IF s.id IS NULL OR c IS NULL OR NOT app.record_sharing_allowed(NEW."tenantId",'salesOrders',NEW."orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT') THEN RAISE EXCEPTION 'Invoice source is unavailable' USING ERRCODE='23514';END IF;
 SELECT (clock_timestamp() AT TIME ZONE coalesce((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=NEW."tenantId"),'UTC'))::date INTO day;
 IF NEW."invoiceDate">day OR NEW."invoiceDate"<s."orderedOn" THEN RAISE EXCEPTION 'Invalid invoice date' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.billing IS DISTINCT FROM OLD.billing) THEN NEW.billing:=app.allocate_invoice_billing(NEW."tenantId",NEW."orderId",NEW.id,NEW.billing->'request');END IF;
 SELECT snapshot INTO accepted FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.reference IS NOT NULL OR NEW.number IS NOT NULL OR s.status<>'CONFIRMED' OR (c->>'archived')::boolean OR (o->>'archived')::boolean
   OR NEW.snapshot->>'kind' IS DISTINCT FROM (CASE WHEN accepted IS NULL THEN 'COMMERCIAL' ELSE 'TAX_AWARE' END) OR NEW.snapshot->'taxAcceptance' IS DISTINCT FROM accepted OR NEW.snapshot->'order' IS DISTINCT FROM s.snapshot OR NEW.snapshot->>'orderReference' IS DISTINCT FROM s.reference OR (NEW.snapshot->>'sourceVersion')::integer IS DISTINCT FROM s.version
   OR NEW.snapshot->'company'->>'id' IS DISTINCT FROM c->>'id' OR NEW.snapshot->>'currency' IS DISTINCT FROM s.currency OR (NEW.snapshot->>'total')::numeric IS DISTINCT FROM (s.snapshot->'calculation'->>'totalKnown')::numeric OR coalesce((NEW.snapshot->>'total')::numeric,0)<=0 THEN
   RAISE EXCEPTION 'Create a commercial draft from the exact confirmed order' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','reference','number','invoiceDate','dueOn','note','updatedAt','billing']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reference','number','invoiceDate','dueOn','note','updatedAt','billing']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invoice source and identity are immutable; use the next version' USING ERRCODE='23514';END IF;
  IF OLD.status='DRAFT' THEN
   IF NEW.status NOT IN ('DRAFT','POSTED','CANCELLED') THEN RAISE EXCEPTION 'Invalid draft transition' USING ERRCODE='23514';END IF;
   IF NEW.status<>'CANCELLED' AND s.status<>'CONFIRMED' THEN RAISE EXCEPTION 'Invoice requires a confirmed order' USING ERRCODE='23514';END IF;
   IF NEW.status='POSTED' THEN
    IF NEW.billing IS DISTINCT FROM OLD.billing THEN RAISE EXCEPTION 'Billing: Save and review changed billing before posting' USING ERRCODE='P0001';END IF;
    SELECT * INTO a FROM public."OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
    IF a."orderId" IS NULL OR a.total<>(NEW.snapshot->>'total')::numeric OR (NEW.snapshot->>'sourceVersion')::integer<>s.version OR (c->>'archived')::boolean OR (o->>'archived')::boolean OR NEW.snapshot->'company'->>'version' IS DISTINCT FROM c->>'version' THEN RAISE EXCEPTION 'Review the opened receivable and saved issuing company before posting' USING ERRCODE='23514';END IF;
    NEW.number:=app.claim_invoice_number(NEW."tenantId",'INV');NEW.reference:='INV/'||lpad(NEW.number::text,greatest(6,length(NEW.number::text)),'0');
   ELSIF NEW.reference IS NOT NULL OR NEW.number IS NOT NULL THEN RAISE EXCEPTION 'Drafts have no posted number' USING ERRCODE='23514';END IF;
  ELSIF OLD.status='POSTED' THEN
   IF NEW.status<>'CREDITED' OR (to_jsonb(NEW)-ARRAY['status','version','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedAt']) OR NOT EXISTS(SELECT 1 FROM public."CustomerCreditNote" n WHERE n."tenantId"=NEW."tenantId" AND n."invoiceId"=NEW.id AND n.amount=(NEW.billing->>'amount')::numeric)
    OR EXISTS(SELECT 1 FROM public."InvoicePaymentApplication" p WHERE p."tenantId"=NEW."tenantId" AND p."invoiceId"=NEW.id AND NOT EXISTS(SELECT 1 FROM public."InvoicePaymentRelease" r WHERE r."tenantId"=p."tenantId" AND r."applicationId"=p.id)) THEN RAISE EXCEPTION 'Posted invoices require a full credit note and release of their applications' USING ERRCODE='23514';END IF;
  ELSE RAISE EXCEPTION 'Final invoice history is immutable' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.invoice_billing_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s jsonb;b jsonb;used numeric;quantity numeric;total numeric;
BEGIN
 SELECT snapshot INTO s FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId";
 SELECT coalesce(sum((billing->>'amount')::numeric),0) INTO total FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" AND status IN ('DRAFT','POSTED');
 IF total>(s->'calculation'->>'totalKnown')::numeric THEN RAISE EXCEPTION 'Billing: Active invoices exceed accepted order value' USING ERRCODE='P0001';END IF;
 FOR b IN SELECT * FROM jsonb_array_elements(app.invoice_billing_order_basis(NEW."tenantId",NEW."orderId")) LOOP
  SELECT coalesce(sum((a->>'amount')::numeric),0),coalesce(sum((a->>'quantity')::numeric),0) INTO used,quantity FROM public."CustomerInvoice" i CROSS JOIN LATERAL jsonb_array_elements(i.billing->'allocations') a WHERE i."tenantId"=NEW."tenantId" AND i."orderId"=NEW."orderId" AND i.status IN ('DRAFT','POSTED') AND a->>'lineIndex'=b->>'lineIndex';
  IF used>(b->>'amount')::numeric OR quantity>(b->>'quantity')::numeric THEN RAISE EXCEPTION 'Billing: Active invoices exceed accepted line value or quantity' USING ERRCODE='P0001';END IF;
 END LOOP;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.tax_order_commercial_invoice_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE accepted jsonb;
BEGIN
 SELECT snapshot INTO accepted FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
 IF accepted IS NOT NULL AND (NEW.snapshot->>'kind' IS DISTINCT FROM 'TAX_AWARE' OR NEW.snapshot->'taxAcceptance' IS DISTINCT FROM accepted OR NEW.billing->'tax'->>'policy' IS DISTINCT FROM 'REMAINING_BALANCE_V1') THEN RAISE EXCEPTION 'Billing: Tax-aware orders require their frozen native tax allocations' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
CREATE FUNCTION app.invoice_tax_history_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId";
 IF TG_TABLE_NAME='CustomerInvoiceTaxSnapshot' THEN
  IF i.version IS DISTINCT FROM NEW.version OR i."orderId" IS DISTINCT FROM NEW."orderId" OR i.billing->'tax' IS DISTINCT FROM NEW.snapshot OR NEW.snapshot IS NULL THEN RAISE EXCEPTION 'Billing: Invoice tax history must freeze its exact current version' USING ERRCODE='23514';END IF;
 ELSE
  IF i.status IS DISTINCT FROM 'POSTED' OR i.version IS DISTINCT FROM NEW."invoiceVersion" OR i.billing->'tax' IS DISTINCT FROM NEW.snapshot OR NOT EXISTS(SELECT 1 FROM public."CustomerCreditNote" n WHERE n."tenantId"=i."tenantId" AND n."invoiceId"=i.id AND n.amount*100=(NEW.snapshot->>'grossMinor')::numeric) THEN RAISE EXCEPTION 'Billing: A tax credit must reverse the original posted allocation' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.invoice_tax_history_proof() FROM PUBLIC;
CREATE TRIGGER invoice_tax_history_proof BEFORE INSERT ON "CustomerInvoiceTaxSnapshot" FOR EACH ROW EXECUTE FUNCTION app.invoice_tax_history_proof();
CREATE TRIGGER credit_tax_history_proof BEFORE INSERT ON "CustomerCreditTaxSnapshot" FOR EACH ROW EXECUTE FUNCTION app.invoice_tax_history_proof();
CREATE TRIGGER invoice_tax_history_immutable BEFORE UPDATE OR DELETE ON "CustomerInvoiceTaxSnapshot" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_immutable();
CREATE TRIGGER credit_tax_history_immutable BEFORE UPDATE OR DELETE ON "CustomerCreditTaxSnapshot" FOR EACH ROW EXECUTE FUNCTION app.quotation_tax_inputs_immutable();
CREATE FUNCTION app.freeze_invoice_tax_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='CustomerInvoice' THEN
  IF NEW.billing->'tax' IS NOT NULL THEN INSERT INTO public."CustomerInvoiceTaxSnapshot"("tenantId","invoiceId",version,"orderId",snapshot) VALUES(NEW."tenantId",NEW.id,NEW.version,NEW."orderId",NEW.billing->'tax');END IF;
 ELSE
  SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId";
  IF i.billing->'tax' IS NOT NULL THEN INSERT INTO public."CustomerCreditTaxSnapshot"("tenantId","invoiceId","invoiceVersion",snapshot) VALUES(NEW."tenantId",NEW."invoiceId",i.version,i.billing->'tax');END IF;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.freeze_invoice_tax_history() FROM PUBLIC;
CREATE TRIGGER freeze_invoice_tax_history AFTER INSERT OR UPDATE ON "CustomerInvoice" FOR EACH ROW EXECUTE FUNCTION app.freeze_invoice_tax_history();
CREATE TRIGGER freeze_credit_tax_history AFTER INSERT ON "CustomerCreditNote" FOR EACH ROW EXECUTE FUNCTION app.freeze_invoice_tax_history();
CREATE FUNCTION app.invoice_tax_balance_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE a jsonb;f jsonb;c jsonb;net numeric;gross numeric;used numeric;
BEGIN
 SELECT snapshot->'agreement' INTO a FROM public."SalesOrderTaxAcceptance" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
 IF a IS NULL THEN RETURN NEW;END IF;
 FOR f IN SELECT * FROM jsonb_array_elements(a->'lines') LOOP
  SELECT coalesce(sum((l->>'netMinor')::numeric),0),coalesce(sum((l->>'grossMinor')::numeric),0) INTO net,gross FROM public."CustomerInvoice" i CROSS JOIN LATERAL jsonb_array_elements(i.billing->'tax'->'lines') l WHERE i."tenantId"=NEW."tenantId" AND i."orderId"=NEW."orderId" AND i.status IN ('DRAFT','POSTED') AND l->>'key'=f->>'key';
  IF net>(f->>'netMinor')::numeric OR gross>(f->>'grossMinor')::numeric THEN RAISE EXCEPTION 'Billing: Active tax allocations exceed the frozen line balance' USING ERRCODE='P0001';END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(f->'components') LOOP
   SELECT coalesce(sum((p->>'amountMinor')::numeric),0) INTO used FROM public."CustomerInvoice" i CROSS JOIN LATERAL jsonb_array_elements(i.billing->'tax'->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'components') p WHERE i."tenantId"=NEW."tenantId" AND i."orderId"=NEW."orderId" AND i.status IN ('DRAFT','POSTED') AND l->>'key'=f->>'key' AND p->>'code'=c->>'code';
   IF used>(c->>'amountMinor')::numeric THEN RAISE EXCEPTION 'Billing: Active tax allocations exceed the frozen component balance' USING ERRCODE='P0001';END IF;
  END LOOP;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.invoice_tax_balance_proof() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER invoice_tax_balance_proof AFTER INSERT OR UPDATE ON "CustomerInvoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.invoice_tax_balance_proof();
CREATE FUNCTION app.tax_invoice_document_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId" AND snapshot->>'kind'='TAX_AWARE') THEN RAISE EXCEPTION 'Billing: Statutory document controls are required before issuing tax-aware invoice or credit PDFs' USING ERRCODE='P0001';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_invoice_document_guard() FROM PUBLIC;
CREATE TRIGGER tax_invoice_document_guard BEFORE INSERT ON "CustomerInvoiceDocument" FOR EACH ROW EXECUTE FUNCTION app.tax_invoice_document_guard();
ALTER TABLE "CustomerInvoiceTaxSnapshot" ENABLE ROW LEVEL SECURITY;ALTER TABLE "CustomerInvoiceTaxSnapshot" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomerCreditTaxSnapshot" ENABLE ROW LEVEL SECURITY;ALTER TABLE "CustomerCreditTaxSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerInvoiceTaxSnapshot" FOR SELECT USING(app.tenant_match("tenantId"));
CREATE POLICY source_read ON "CustomerInvoiceTaxSnapshot" AS RESTRICTIVE FOR SELECT USING(current_setting('app.rls_bypass',true)='on' OR "invoiceId" IN (SELECT id FROM "CustomerInvoice" WHERE "tenantId"="CustomerInvoiceTaxSnapshot"."tenantId"));
CREATE POLICY tenant_isolation ON "CustomerCreditTaxSnapshot" FOR SELECT USING(app.tenant_match("tenantId"));
CREATE POLICY source_read ON "CustomerCreditTaxSnapshot" AS RESTRICTIVE FOR SELECT USING(current_setting('app.rls_bypass',true)='on' OR "invoiceId" IN (SELECT "invoiceId" FROM "CustomerCreditNote" WHERE "tenantId"="CustomerCreditTaxSnapshot"."tenantId"));
DO $$ DECLARE who text;BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN EXECUTE format('GRANT SELECT ON "CustomerInvoiceTaxSnapshot","CustomerCreditTaxSnapshot" TO %I',who);END IF;END LOOP;END $$;
COMMIT;
