BEGIN;
CREATE TABLE "CustomerInvoiceSequence"("tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,kind text NOT NULL CHECK(kind IN ('INV','CN')),value integer NOT NULL CHECK(value>0),PRIMARY KEY("tenantId",kind));
ALTER TABLE "CustomerInvoiceSequence" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CustomerInvoiceSequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY numbering_private ON "CustomerInvoiceSequence" FOR ALL USING(false) WITH CHECK(false);
CREATE TABLE "CustomerInvoice"(
 "tenantId" text NOT NULL,id text NOT NULL,"orderId" text NOT NULL,"requestKey" text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED','CREDITED')),version integer NOT NULL DEFAULT 1 CHECK(version>0),reference text,number integer,
 "invoiceDate" date NOT NULL,"dueOn" date,note text NOT NULL DEFAULT '' CHECK(length(note)<=6000),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 "createdBy" text NOT NULL,"actorName" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId",id),UNIQUE("tenantId","orderId",id),UNIQUE("tenantId","requestKey"),UNIQUE("tenantId",reference),UNIQUE("tenantId",number),
 FOREIGN KEY("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK("dueOn" IS NULL OR "dueOn">="invoiceDate"),CHECK((status IN ('DRAFT','CANCELLED') AND reference IS NULL AND number IS NULL) OR (status IN ('POSTED','CREDITED') AND number>0 AND reference='INV/'||lpad(number::text,greatest(6,length(number::text)),'0')))
);
CREATE UNIQUE INDEX invoice_one_active_order ON "CustomerInvoice"("tenantId","orderId") WHERE status IN ('DRAFT','POSTED');
CREATE INDEX "CustomerInvoice_tenantId_orderId_createdAt_id_idx" ON "CustomerInvoice"("tenantId","orderId","createdAt" DESC,id);
CREATE TABLE "CustomerCreditNote"(
 "tenantId" text NOT NULL,"invoiceId" text NOT NULL,reference text NOT NULL,number integer NOT NULL CHECK(number>0),"requestKey" text NOT NULL,"effectiveOn" date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),amount numeric(18,4) NOT NULL CHECK(amount>0),"createdBy" text NOT NULL,"actorName" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","invoiceId"),UNIQUE("tenantId",reference),UNIQUE("tenantId",number),UNIQUE("tenantId","requestKey"),
 FOREIGN KEY("tenantId","invoiceId") REFERENCES "CustomerInvoice"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CustomerInvoiceEvent"(
 "tenantId" text NOT NULL,"invoiceId" text NOT NULL,version integer NOT NULL,status text NOT NULL,"actorId" text NOT NULL,"actorName" text NOT NULL,reason text NOT NULL DEFAULT '',"requestKey" text NOT NULL,"requestHash" text NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","invoiceId",version),UNIQUE("tenantId","requestKey"),FOREIGN KEY("tenantId","invoiceId") REFERENCES "CustomerInvoice"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "InvoicePaymentApplication"(
 "tenantId" text NOT NULL,id text NOT NULL,"invoiceId" text NOT NULL,"orderId" text NOT NULL,"paymentId" text NOT NULL,"requestKey" text NOT NULL,amount numeric(18,4) NOT NULL CHECK(amount>0),
 "createdBy" text NOT NULL,"actorName" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId",id),UNIQUE("tenantId","requestKey"),
 FOREIGN KEY("tenantId","orderId","invoiceId") REFERENCES "CustomerInvoice"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","orderId","paymentId") REFERENCES "OrderReceipt"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoicePaymentApplication_tenantId_invoiceId_createdAt_id_idx" ON "InvoicePaymentApplication"("tenantId","invoiceId","createdAt" DESC,id);
CREATE TABLE "InvoicePaymentRelease"(
 "tenantId" text NOT NULL,"applicationId" text NOT NULL,"requestKey" text NOT NULL,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),"createdBy" text NOT NULL,"actorName" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId","applicationId"),UNIQUE("tenantId","requestKey"),FOREIGN KEY("tenantId","applicationId") REFERENCES "InvoicePaymentApplication"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CustomerInvoiceDocument"(
 "tenantId" text NOT NULL,id text NOT NULL,"invoiceId" text NOT NULL,"companyId" text NOT NULL,"providerKey" text NOT NULL CHECK("providerKey" IN ('commercial-invoice','commercial-credit-note')),"templateVersion" integer NOT NULL,
 version integer NOT NULL CHECK(version>0),reference text NOT NULL,"requestKey" text NOT NULL,"requestHash" text NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 archive jsonb NOT NULL CHECK(jsonb_typeof(archive)='object' AND archive ?& ARRAY['path','bytes','sha256','issuedAt','issuedBy'] AND coalesce((archive->>'bytes')::integer BETWEEN 1 AND 10485760 AND archive->>'sha256' ~ '^[a-f0-9]{64}$',false)),
 "supersedesId" text,reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),"createdBy" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId",id),UNIQUE("tenantId","requestKey"),UNIQUE("tenantId",reference),UNIQUE("tenantId","invoiceId","providerKey",version),UNIQUE("tenantId","invoiceId","providerKey",id),UNIQUE("tenantId","supersedesId"),
 FOREIGN KEY("tenantId","invoiceId") REFERENCES "CustomerInvoice"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","companyId","providerKey","templateVersion") REFERENCES "BusinessDocumentTemplate"("tenantId","companyId","providerKey",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","invoiceId","providerKey","supersedesId") REFERENCES "CustomerInvoiceDocument"("tenantId","invoiceId","providerKey",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 CHECK(("supersedesId" IS NULL AND version=1) OR ("supersedesId" IS NOT NULL AND version>1 AND length(trim(reason))>0)),
 CHECK(coalesce(snapshot->'payload'->>'reference'=reference AND snapshot->'payload'->'company'->>'id'="companyId" AND archive->>'issuedBy'="createdBy",false)),
 CHECK(coalesce(left(archive->>'path',length("tenantId"||'/invoices/'||"invoiceId"||'/'||id||'/'))="tenantId"||'/invoices/'||"invoiceId"||'/'||id||'/',false))
);
CREATE INDEX "CustomerInvoiceDocument_tenantId_invoiceId_createdAt_id_idx" ON "CustomerInvoiceDocument"("tenantId","invoiceId","createdAt" DESC,id);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['CustomerInvoice','CustomerCreditNote','CustomerInvoiceEvent','InvoicePaymentApplication','InvoicePaymentRelease','CustomerInvoiceDocument'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"))',t);
 IF t<>'CustomerInvoice' THEN EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event()',t);END IF;
END LOOP;END $$;
CREATE POLICY invoice_source ON "CustomerInvoice" AS RESTRICTIVE FOR ALL USING(EXISTS(SELECT 1 FROM "SalesOrder" s WHERE s."tenantId"="CustomerInvoice"."tenantId" AND s.id="CustomerInvoice"."orderId")) WITH CHECK(EXISTS(SELECT 1 FROM "SalesOrder" s WHERE s."tenantId"="CustomerInvoice"."tenantId" AND s.id="CustomerInvoice"."orderId") AND app.record_sharing_allowed("tenantId",'salesOrders',"orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT'));
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['CustomerCreditNote','CustomerInvoiceEvent','CustomerInvoiceDocument'] LOOP
 EXECUTE format('CREATE POLICY invoice_parent ON %I AS RESTRICTIVE FOR ALL USING(EXISTS(SELECT 1 FROM "CustomerInvoice" i WHERE i."tenantId"=%I."tenantId" AND i.id=%I."invoiceId")) WITH CHECK(EXISTS(SELECT 1 FROM "CustomerInvoice" i WHERE i."tenantId"=%I."tenantId" AND i.id=%I."invoiceId" AND app.record_sharing_allowed(i."tenantId",''salesOrders'',i."orderId",coalesce(current_setting(''app.actor_id'',true),''''),''EDIT'')))',t,t,t,t,t);
END LOOP;END $$;
CREATE POLICY application_sources ON "InvoicePaymentApplication" AS RESTRICTIVE FOR ALL USING(EXISTS(SELECT 1 FROM "CustomerInvoice" i WHERE i."tenantId"="InvoicePaymentApplication"."tenantId" AND i.id="InvoicePaymentApplication"."invoiceId") AND EXISTS(SELECT 1 FROM "OrderReceipt" p WHERE p."tenantId"="InvoicePaymentApplication"."tenantId" AND p.id="InvoicePaymentApplication"."paymentId")) WITH CHECK(EXISTS(SELECT 1 FROM "CustomerInvoice" i WHERE i."tenantId"="InvoicePaymentApplication"."tenantId" AND i.id="InvoicePaymentApplication"."invoiceId") AND EXISTS(SELECT 1 FROM "OrderReceipt" p WHERE p."tenantId"="InvoicePaymentApplication"."tenantId" AND p.id="InvoicePaymentApplication"."paymentId") AND app.record_sharing_allowed("tenantId",'salesOrders',"orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY release_source ON "InvoicePaymentRelease" AS RESTRICTIVE FOR ALL USING(EXISTS(SELECT 1 FROM "InvoicePaymentApplication" a WHERE a."tenantId"="InvoicePaymentRelease"."tenantId" AND a.id="InvoicePaymentRelease"."applicationId")) WITH CHECK(EXISTS(SELECT 1 FROM "InvoicePaymentApplication" a WHERE a."tenantId"="InvoicePaymentRelease"."tenantId" AND a.id="InvoicePaymentRelease"."applicationId" AND app.record_sharing_allowed(a."tenantId",'salesOrders',a."orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT')));

CREATE FUNCTION app.claim_invoice_number(t text,k text) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 INSERT INTO public."CustomerInvoiceSequence"("tenantId",kind,value) VALUES(t,k,1) ON CONFLICT("tenantId",kind) DO UPDATE SET value="CustomerInvoiceSequence".value+1 RETURNING value
$$;
REVOKE ALL ON FUNCTION app.claim_invoice_number(text,text) FROM PUBLIC;
CREATE FUNCTION app.commercial_invoice_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE s public."SalesOrder"%ROWTYPE; c jsonb; o jsonb; a public."OrderReceivable"%ROWTYPE; day date;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history is immutable' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 SELECT company,office INTO c,o FROM app.document_source_issuer(NEW."tenantId",NEW."orderId");
 IF s.id IS NULL OR c IS NULL OR NOT app.record_sharing_allowed(NEW."tenantId",'salesOrders',NEW."orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT') THEN RAISE EXCEPTION 'Invoice source is unavailable' USING ERRCODE='23514';END IF;
 SELECT (clock_timestamp() AT TIME ZONE coalesce((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=NEW."tenantId"),'UTC'))::date INTO day;
 IF NEW."invoiceDate">day OR NEW."invoiceDate"<s."orderedOn" THEN RAISE EXCEPTION 'Invalid invoice date' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.version<>1 OR NEW.reference IS NOT NULL OR NEW.number IS NOT NULL OR s.status<>'CONFIRMED' OR (c->>'archived')::boolean OR (o->>'archived')::boolean
   OR NEW.snapshot->>'kind' IS DISTINCT FROM 'COMMERCIAL' OR NEW.snapshot->'order' IS DISTINCT FROM s.snapshot OR NEW.snapshot->>'orderReference' IS DISTINCT FROM s.reference OR (NEW.snapshot->>'sourceVersion')::integer IS DISTINCT FROM s.version
   OR NEW.snapshot->'company'->>'id' IS DISTINCT FROM c->>'id' OR NEW.snapshot->>'currency' IS DISTINCT FROM s.currency OR (NEW.snapshot->>'total')::numeric IS DISTINCT FROM (s.snapshot->'calculation'->>'totalKnown')::numeric OR coalesce((NEW.snapshot->>'total')::numeric,0)<=0 THEN
   RAISE EXCEPTION 'Create a commercial draft from the exact confirmed order' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','reference','number','invoiceDate','dueOn','note','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reference','number','invoiceDate','dueOn','note','updatedAt']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invoice source and identity are immutable; use the next version' USING ERRCODE='23514';END IF;
  IF OLD.status='DRAFT' THEN
   IF NEW.status NOT IN ('DRAFT','POSTED','CANCELLED') THEN RAISE EXCEPTION 'Invalid draft transition' USING ERRCODE='23514';END IF;
   IF NEW.status<>'CANCELLED' AND s.status<>'CONFIRMED' THEN RAISE EXCEPTION 'Invoice requires a confirmed order' USING ERRCODE='23514';END IF;
   IF NEW.status='POSTED' THEN
    SELECT * INTO a FROM public."OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
    IF a."orderId" IS NULL OR a.total<>(NEW.snapshot->>'total')::numeric OR (NEW.snapshot->>'sourceVersion')::integer<>s.version OR (c->>'archived')::boolean OR (o->>'archived')::boolean OR NEW.snapshot->'company'->>'version' IS DISTINCT FROM c->>'version' THEN RAISE EXCEPTION 'Review the opened receivable and saved issuing company before posting' USING ERRCODE='23514';END IF;
    NEW.number:=app.claim_invoice_number(NEW."tenantId",'INV');NEW.reference:='INV/'||lpad(NEW.number::text,greatest(6,length(NEW.number::text)),'0');
   ELSIF NEW.reference IS NOT NULL OR NEW.number IS NOT NULL THEN RAISE EXCEPTION 'Drafts have no posted number' USING ERRCODE='23514';END IF;
  ELSIF OLD.status='POSTED' THEN
   IF NEW.status<>'CREDITED' OR (to_jsonb(NEW)-ARRAY['status','version','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updatedAt']) OR NOT EXISTS(SELECT 1 FROM public."CustomerCreditNote" n WHERE n."tenantId"=NEW."tenantId" AND n."invoiceId"=NEW.id AND n.amount=(NEW.snapshot->>'total')::numeric)
    OR EXISTS(SELECT 1 FROM public."InvoicePaymentApplication" p WHERE p."tenantId"=NEW."tenantId" AND p."invoiceId"=NEW.id AND NOT EXISTS(SELECT 1 FROM public."InvoicePaymentRelease" r WHERE r."tenantId"=p."tenantId" AND r."applicationId"=p.id)) THEN RAISE EXCEPTION 'Posted invoices require a full credit note and release of their applications' USING ERRCODE='23514';END IF;
  ELSE RAISE EXCEPTION 'Final invoice history is immutable' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.commercial_invoice_write() FROM PUBLIC;
CREATE TRIGGER invoice_write BEFORE INSERT OR UPDATE OR DELETE ON "CustomerInvoice" FOR EACH ROW EXECUTE FUNCTION app.commercial_invoice_write();
CREATE FUNCTION app.commercial_credit_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE; day date;
BEGIN
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId";
 PERFORM 1 FROM public."SalesOrder" WHERE "tenantId"=i."tenantId" AND id=i."orderId" FOR UPDATE;
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=NEW."invoiceId" FOR UPDATE;
 SELECT (clock_timestamp() AT TIME ZONE coalesce((SELECT "timeZone" FROM public."AppSetting" WHERE "tenantId"=NEW."tenantId"),'UTC'))::date INTO day;
 IF i.status IS DISTINCT FROM 'POSTED' OR NEW.amount IS DISTINCT FROM (i.snapshot->>'total')::numeric OR NEW."effectiveOn"<i."invoiceDate" OR NEW."effectiveOn">day OR NOT EXISTS(SELECT 1 FROM app.document_source_issuer(i."tenantId",i."orderId")) THEN RAISE EXCEPTION 'A full credit must retain its posted commercial invoice' USING ERRCODE='23514';END IF;
 NEW.number:=app.claim_invoice_number(NEW."tenantId",'CN');NEW.reference:='CN/'||lpad(NEW.number::text,greatest(6,length(NEW.number::text)),'0');RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.commercial_credit_write() FROM PUBLIC;
CREATE TRIGGER credit_write BEFORE INSERT ON "CustomerCreditNote" FOR EACH ROW EXECUTE FUNCTION app.commercial_credit_write();
CREATE FUNCTION app.invoice_final_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE i public."CustomerInvoice"%ROWTYPE;k text;
BEGIN
 k:=to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='CustomerInvoice' THEN 'id' ELSE 'invoiceId' END);
 SELECT * INTO i FROM public."CustomerInvoice" WHERE "tenantId"=NEW."tenantId" AND id=k;
 IF NOT EXISTS(SELECT 1 FROM public."CustomerInvoiceEvent" e WHERE e."tenantId"=i."tenantId" AND e."invoiceId"=i.id AND e.version=i.version AND e.status=i.status) OR (TG_TABLE_NAME='CustomerCreditNote' AND i.status<>'CREDITED') THEN RAISE EXCEPTION 'Invoice transition requires immutable history and coherent credit state' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.invoice_final_proof() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER invoice_proof AFTER INSERT OR UPDATE ON "CustomerInvoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.invoice_final_proof();
CREATE CONSTRAINT TRIGGER credit_proof AFTER INSERT ON "CustomerCreditNote" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.invoice_final_proof();

CREATE FUNCTION app.invoice_application_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
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
 IF used+NEW.amount>(i.snapshot->>'total')::numeric THEN RAISE EXCEPTION 'Application exceeds invoice balance' USING ERRCODE='23514';END IF;
 SELECT coalesce(sum(a.amount),0) INTO used FROM public."InvoicePaymentApplication" a JOIN public."CustomerInvoice" x ON x."tenantId"=a."tenantId" AND x.id=a."invoiceId" WHERE a."tenantId"=p."tenantId" AND a."paymentId"=p.id AND x.status='POSTED' AND NOT EXISTS(SELECT 1 FROM public."InvoicePaymentRelease" r WHERE r."tenantId"=a."tenantId" AND r."applicationId"=a.id);
 IF used+NEW.amount>p.amount THEN RAISE EXCEPTION 'Application exceeds available payment' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.invoice_application_write() FROM PUBLIC;
CREATE TRIGGER application_write BEFORE INSERT ON "InvoicePaymentApplication" FOR EACH ROW EXECUTE FUNCTION app.invoice_application_write();
CREATE TRIGGER application_release BEFORE INSERT ON "InvoicePaymentRelease" FOR EACH ROW EXECUTE FUNCTION app.invoice_application_write();
CREATE FUNCTION app.has_posted_invoice(t text,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."CustomerInvoice" i WHERE i."tenantId"=t AND i."orderId"=k AND i.status='POSTED') WHERE EXISTS(SELECT 1 FROM app.document_source_issuer(t,k))
$$;
REVOKE ALL ON FUNCTION app.has_posted_invoice(text,text) FROM PUBLIC;
CREATE FUNCTION app.invoice_order_cancel_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN IF NEW.status='CANCELLED' AND EXISTS(SELECT 1 FROM public."CustomerInvoice" i WHERE i."tenantId"=NEW."tenantId" AND i."orderId"=NEW.id AND i.status='POSTED') THEN RAISE EXCEPTION 'Fully credit posted invoices before cancelling the order' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION app.invoice_order_cancel_guard() FROM PUBLIC;
CREATE TRIGGER invoice_order_cancel BEFORE UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.invoice_order_cancel_guard();
CREATE FUNCTION app.invoice_document_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
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
 IF NEW.version<>coalesce(previous.version,0)+1 OR NEW."supersedesId" IS DISTINCT FROM previous.id OR NEW.reference IS DISTINCT FROM base||'/V'||NEW.version::text OR NEW.snapshot->'evidence'->>'invoiceId' IS DISTINCT FROM i.id OR (NEW.snapshot->'evidence'->>'invoiceVersion')::integer IS DISTINCT FROM i.version OR (NEW.snapshot->'evidence'->>'total')::numeric IS DISTINCT FROM (i.snapshot->>'total')::numeric THEN RAISE EXCEPTION 'Invoice document chain or frozen evidence mismatch' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.invoice_document_chain() FROM PUBLIC;
CREATE TRIGGER invoice_document_chain BEFORE INSERT ON "CustomerInvoiceDocument" FOR EACH ROW EXECUTE FUNCTION app.invoice_document_chain();
DO $$ DECLARE who text;BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON "CustomerInvoice" TO %I',who);
 EXECUTE format('GRANT SELECT,INSERT ON "CustomerCreditNote","CustomerInvoiceEvent","InvoicePaymentApplication","InvoicePaymentRelease","CustomerInvoiceDocument" TO %I',who);
 EXECUTE format('GRANT EXECUTE ON FUNCTION app.has_posted_invoice(text,text) TO %I',who);
 END IF;END LOOP;END $$;
-- No source rows, historical payments, allocations, profiles or module grants change.
COMMIT;
