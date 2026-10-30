BEGIN;
ALTER TABLE "CustomerInvoice" ADD COLUMN billing jsonb;

-- Allocate the exact accepted total (including agreed discounts/charges) across
-- source lines once. Cumulative rounding conserves every currency minor unit.
CREATE FUNCTION app.invoice_billing_basis(s jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH lines AS (SELECT value,ordinality-1 idx,(value->>'amount')::numeric weight FROM jsonb_array_elements(s->'calculation'->'lines') WITH ORDINALITY),
 weights AS (SELECT *,CASE WHEN sum(weight) OVER()>0 THEN weight ELSE 1 END w FROM lines),
 running AS (SELECT *,sum(w) OVER(ORDER BY idx) running,sum(w) OVER() total FROM weights),
 allocated AS (SELECT *,round((s->'calculation'->>'totalKnown')::numeric*running/total,length(split_part(s->'calculation'->>'totalKnown','.',2))) edge FROM running)
 SELECT coalesce(jsonb_agg(jsonb_build_object('lineIndex',idx,'description',value->>'description','unit',value->>'unit','sourceQuantity',value->>'quantity','quantity',value->>'quantity','amount',(edge-coalesce(lag_edge,0))::text) ORDER BY idx),'[]'::jsonb)
 FROM (SELECT *,lag(edge) OVER(ORDER BY idx) lag_edge FROM allocated) q
$$;
REVOKE ALL ON FUNCTION app.invoice_billing_basis(jsonb) FROM PUBLIC;

-- Historical invoices were full-order documents. Add that fact without changing
-- any preceding column, transition, number, snapshot, application or PDF archive.
ALTER TABLE "CustomerInvoice" DISABLE TRIGGER invoice_write;
UPDATE "CustomerInvoice" SET billing=jsonb_build_object('format',1,'request',jsonb_build_object('mode','FULL','label',''),'amount',snapshot->>'total','allocations',
 (SELECT jsonb_agg(jsonb_build_object('lineIndex',r->'lineIndex','quantity',r->>'quantity','amount',r->>'amount')) FROM jsonb_array_elements(app.invoice_billing_basis(snapshot->'order')) r));
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "CustomerInvoice" ENABLE TRIGGER invoice_write;
SET CONSTRAINTS ALL DEFERRED;
ALTER TABLE "CustomerInvoice" ALTER COLUMN billing SET NOT NULL;
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT invoice_billing_shape CHECK(jsonb_typeof(billing)='object' AND billing->>'format'='1' AND (billing->>'amount')::numeric>0 AND jsonb_typeof(billing->'allocations')='array' AND octet_length(billing::text)<=131072);
DROP INDEX invoice_one_active_order;
CREATE INDEX invoice_order_billing_active ON "CustomerInvoice"("tenantId","orderId") WHERE status IN ('DRAFT','POSTED');

CREATE FUNCTION app.invoice_billing_capacity(t text,k text,skip text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s public."SalesOrder"%ROWTYPE;basis jsonb;lines jsonb;milestones jsonb;posted numeric;reserved numeric;credited numeric;total numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.document_source_issuer(t,k)) THEN RAISE EXCEPTION 'Billing: Source order unavailable' USING ERRCODE='P0001';END IF;
 SELECT * INTO s FROM public."SalesOrder" WHERE "tenantId"=t AND id=k;
 basis:=app.invoice_billing_basis(s.snapshot);total:=(s.snapshot->'calculation'->>'totalKnown')::numeric;
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
 RETURN jsonb_build_object('currency',s.currency,'customer',s.snapshot->'customer'->>'name','orderReference',s.reference,'contractTotal',total::text,'posted',posted::text,'credited',credited::text,'reserved',reserved::text,'unbilled',(total-posted)::text,'available',(total-posted-reserved)::text,'lines',coalesce(lines,'[]'::jsonb),'milestones',milestones);
END $$;
REVOKE ALL ON FUNCTION app.invoice_billing_capacity(text,text,text) FROM PUBLIC;

CREATE FUNCTION app.allocate_invoice_billing(t text,k text,skip text,req jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE c jsonb;b jsonb;allocations jsonb:='[]';r jsonb;mode text:=req->>'mode';desired numeric:=0;available numeric;part numeric;q numeric;running numeric:=0;allocated numeric:=0;edge numeric;digits integer;value numeric;
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
 RETURN jsonb_build_object('format',1,'request',req,'amount',desired::text,'allocations',allocations);
END $$;
REVOKE ALL ON FUNCTION app.allocate_invoice_billing(text,text,text,jsonb) FROM PUBLIC;

-- Transition guards below retain accepted source identity and immutable history,
-- but invoice amounts now come from the independently frozen billed allocation.

CREATE OR REPLACE FUNCTION app.commercial_invoice_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s public."SalesOrder"%ROWTYPE; c jsonb; o jsonb; a public."OrderReceivable"%ROWTYPE; day date;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 SELECT company,office INTO c,o FROM app.document_source_issuer(NEW."tenantId",NEW."orderId");
 IF s.id IS NULL OR c IS NULL OR NOT app.record_sharing_allowed(NEW."tenantId",'salesOrders',NEW."orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT') THEN RAISE EXCEPTION 'Invoice source is unavailable' USING ERRCODE='23514';END IF;
 SELECT (clock_timestamp() AT TIME ZONE coalesce((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=NEW."tenantId"),'UTC'))::date INTO day;
 IF NEW."invoiceDate">day OR NEW."invoiceDate"<s."orderedOn" THEN RAISE EXCEPTION 'Invalid invoice date' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.billing IS DISTINCT FROM OLD.billing) THEN NEW.billing:=app.allocate_invoice_billing(NEW."tenantId",NEW."orderId",NEW.id,NEW.billing->'request');END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.reference IS NOT NULL OR NEW.number IS NOT NULL OR s.status<>'CONFIRMED' OR (c->>'archived')::boolean OR (o->>'archived')::boolean
   OR NEW.snapshot->>'kind' IS DISTINCT FROM 'COMMERCIAL' OR NEW.snapshot->'order' IS DISTINCT FROM s.snapshot OR NEW.snapshot->>'orderReference' IS DISTINCT FROM s.reference OR (NEW.snapshot->>'sourceVersion')::integer IS DISTINCT FROM s.version
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

CREATE OR REPLACE FUNCTION app.commercial_credit_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE; day date;
BEGIN
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId";
 PERFORM 1 FROM public."SalesOrder" WHERE "tenantId"=i."tenantId" AND id=i."orderId" FOR UPDATE;
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId" FOR UPDATE;
 SELECT (clock_timestamp() AT TIME ZONE coalesce((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=NEW."tenantId"),'UTC'))::date INTO day;
 IF i.status IS DISTINCT FROM 'POSTED' OR NEW.amount IS DISTINCT FROM (i.billing->>'amount')::numeric OR NEW."effectiveOn"<i."invoiceDate" OR NEW."effectiveOn">day OR NOT EXISTS(SELECT 1 FROM app.document_source_issuer(i."tenantId",i."orderId")) THEN RAISE EXCEPTION 'A full credit must retain its posted commercial invoice' USING ERRCODE='23514';END IF;
 NEW.number:=app.claim_invoice_number(NEW."tenantId",'CN');NEW.reference:='CN/'||lpad(NEW.number::text,greatest(6,length(NEW.number::text)),'0');RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.invoice_application_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE;p public."OrderReceipt"%ROWTYPE;used numeric;ceiling numeric;order_key text;
BEGIN
 IF TG_TABLE_NAME='InvoicePaymentRelease' THEN
  SELECT a."orderId" INTO order_key FROM public."InvoicePaymentApplication" a WHERE a."tenantId"=NEW."tenantId" AND a.id=NEW."applicationId";
  PERFORM 1 FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=order_key FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public."InvoicePaymentApplication" a JOIN public."CustomerInvoice" x ON x."tenantId"=a."tenantId" AND x.id=a."invoiceId" WHERE a."tenantId"=NEW."tenantId" AND a.id=NEW."applicationId" AND x.status='POSTED') THEN RAISE EXCEPTION 'Release only an application on a posted invoice' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 PERFORM 1 FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId" AND "orderId"=NEW."orderId";
 SELECT * INTO p FROM public."OrderReceipt" WHERE "tenantId"=NEW."tenantId" AND id=NEW."paymentId" AND "orderId"=NEW."orderId";
 IF i.status IS DISTINCT FROM 'POSTED' OR p.status IS DISTINCT FROM 'POSTED' THEN RAISE EXCEPTION 'Apply only a posted payment to its posted invoice' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(a.amount),0) INTO used FROM public."InvoicePaymentApplication" a JOIN public."OrderReceipt" q ON q."tenantId"=a."tenantId" AND q.id=a."paymentId" WHERE a."tenantId"=i."tenantId" AND a."invoiceId"=i.id AND q.status='POSTED' AND NOT EXISTS(SELECT 1 FROM public."InvoicePaymentRelease" r WHERE r."tenantId"=a."tenantId" AND r."applicationId"=a.id);
 IF used+NEW.amount>(i.billing->>'amount')::numeric THEN RAISE EXCEPTION 'Application exceeds invoice balance' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(a.amount),0) INTO used FROM public."InvoicePaymentApplication" a JOIN public."CustomerInvoice" x ON x."tenantId"=a."tenantId" AND x.id=a."invoiceId" WHERE a."tenantId"=p."tenantId" AND a."paymentId"=p.id AND x.status='POSTED' AND NOT EXISTS(SELECT 1 FROM public."InvoicePaymentRelease" r WHERE r."tenantId"=a."tenantId" AND r."applicationId"=a.id);
 IF used+NEW.amount>p.amount THEN RAISE EXCEPTION 'Application exceeds available payment' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.invoice_document_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE;n public."CustomerCreditNote"%ROWTYPE;previous public."CustomerInvoiceDocument"%ROWTYPE;t public."BusinessDocumentTemplate"%ROWTYPE;base text;
BEGIN
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId";
 PERFORM 1 FROM public."SalesOrder" WHERE "tenantId"=i."tenantId" AND id=i."orderId" FOR UPDATE;
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId";
 IF NEW."providerKey"='commercial-invoice' THEN IF i.status<>'POSTED' THEN RAISE EXCEPTION 'Only posted invoices can issue a current invoice PDF' USING ERRCODE='23514';END IF;base:=i.reference;
 ELSE SELECT * INTO n FROM public."CustomerCreditNote" WHERE "tenantId"=i."tenantId" AND "invoiceId"=i.id;IF i.status<>'CREDITED' OR n.reference IS NULL THEN RAISE EXCEPTION 'Credit-note evidence missing' USING ERRCODE='23514';END IF;base:=n.reference;END IF;
 IF NEW."companyId" IS DISTINCT FROM i.snapshot->'company'->>'id' OR NOT EXISTS(SELECT 1 FROM app.document_source_issuer(i."tenantId",i."orderId") WHERE company->>'id'=NEW."companyId" AND NOT (company->>'archived')::boolean AND NOT (office->>'archived')::boolean) THEN RAISE EXCEPTION 'Issuing company must match saved invoice source' USING ERRCODE='23514';END IF;
 SELECT * INTO t FROM public."BusinessDocumentTemplate" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "providerKey"=NEW."providerKey" ORDER BY version DESC LIMIT 1;
 IF t.version IS DISTINCT FROM NEW."templateVersion" OR NOT coalesce((t.content->>'enabled')::boolean,false) THEN RAISE EXCEPTION 'Review current enabled invoice template' USING ERRCODE='23514';END IF;
 SELECT * INTO previous FROM public."CustomerInvoiceDocument" WHERE "tenantId"=NEW."tenantId" AND "invoiceId"=NEW."invoiceId" AND "providerKey"=NEW."providerKey" ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(previous.version,0)+1 OR NEW."supersedesId" IS DISTINCT FROM previous.id OR NEW.reference IS DISTINCT FROM base||'/V'||NEW.version::text OR NEW.snapshot->'evidence'->>'invoiceId' IS DISTINCT FROM i.id OR (NEW.snapshot->'evidence'->>'invoiceVersion')::integer IS DISTINCT FROM i.version OR (NEW.snapshot->'evidence'->>'total')::numeric IS DISTINCT FROM (i.billing->>'amount')::numeric THEN RAISE EXCEPTION 'Invoice document chain or frozen evidence mismatch' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
DO $$ DECLARE who text;BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION app.invoice_billing_capacity(text,text,text),app.allocate_invoice_billing(text,text,text,jsonb) TO %I',who);
 END IF;END LOOP;END $$;
CREATE FUNCTION app.invoice_billing_final() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s jsonb;b jsonb;used numeric;quantity numeric;total numeric;
BEGIN
 SELECT snapshot INTO s FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId";
 SELECT coalesce(sum((billing->>'amount')::numeric),0) INTO total FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" AND status IN ('DRAFT','POSTED');
 IF total>(s->'calculation'->>'totalKnown')::numeric THEN RAISE EXCEPTION 'Billing: Active invoices exceed accepted order value' USING ERRCODE='P0001';END IF;
 FOR b IN SELECT * FROM jsonb_array_elements(app.invoice_billing_basis(s)) LOOP
  SELECT coalesce(sum((a->>'amount')::numeric),0),coalesce(sum((a->>'quantity')::numeric),0) INTO used,quantity FROM public."CustomerInvoice" i CROSS JOIN LATERAL jsonb_array_elements(i.billing->'allocations') a WHERE i."tenantId"=NEW."tenantId" AND i."orderId"=NEW."orderId" AND i.status IN ('DRAFT','POSTED') AND a->>'lineIndex'=b->>'lineIndex';
  IF used>(b->>'amount')::numeric OR quantity>(b->>'quantity')::numeric THEN RAISE EXCEPTION 'Billing: Active invoices exceed accepted line value or quantity' USING ERRCODE='P0001';END IF;
 END LOOP;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.invoice_billing_final() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER invoice_billing_final AFTER INSERT OR UPDATE ON "CustomerInvoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.invoice_billing_final();
COMMIT;
