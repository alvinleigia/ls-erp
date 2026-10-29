BEGIN;
CREATE TABLE "ReceiptDocumentSequence" (
 "tenantId" text PRIMARY KEY REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 value integer NOT NULL CHECK(value>0)
);
ALTER TABLE "ReceiptDocumentSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptDocumentSequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY numbering_private ON "ReceiptDocumentSequence" FOR ALL USING(false) WITH CHECK(false);
CREATE TABLE "OrderReceiptDocument" (
 "tenantId" text NOT NULL,id text NOT NULL,"orderId" text NOT NULL,"paymentId" text NOT NULL,"companyId" text NOT NULL,
 "providerKey" text NOT NULL CHECK("providerKey"='payment-receipt'),"templateVersion" integer NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),version integer NOT NULL CHECK(version>0),reference text NOT NULL,
 "requestKey" text NOT NULL,"requestHash" text NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=524288),
 archive jsonb NOT NULL CHECK(jsonb_typeof(archive)='object' AND archive ?& ARRAY['path','bytes','sha256','issuedAt','issuedBy'] AND coalesce((archive->>'bytes')::integer BETWEEN 1 AND 10485760 AND archive->>'sha256' ~ '^[a-f0-9]{64}$',false)),
 "supersedesId" text,reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),"createdBy" text NOT NULL,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("tenantId",id),
 FOREIGN KEY("tenantId","orderId","paymentId") REFERENCES "OrderReceipt"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","companyId","providerKey","templateVersion") REFERENCES "BusinessDocumentTemplate"("tenantId","companyId","providerKey",version) ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE("tenantId","paymentId",id),
 FOREIGN KEY("tenantId","paymentId","supersedesId") REFERENCES "OrderReceiptDocument"("tenantId","paymentId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 UNIQUE("tenantId","requestKey"),UNIQUE("tenantId",reference),UNIQUE("tenantId","paymentId",version),UNIQUE("tenantId",sequence,version),UNIQUE("tenantId","supersedesId"),
 CHECK(("supersedesId" IS NULL AND version=1) OR ("supersedesId" IS NOT NULL AND version>1 AND length(trim(reason))>0)),
 CHECK(coalesce(snapshot->'payload'->>'reference'=reference AND snapshot->'payload'->'company'->>'id'="companyId",false)),
 CHECK(coalesce(left(archive->>'path',length("tenantId"||'/receipts/'||"paymentId"||'/'||id||'/'))="tenantId"||'/receipts/'||"paymentId"||'/'||id||'/',false)),
 CHECK(coalesce(archive->>'issuedBy'="createdBy",false))
);
CREATE INDEX "OrderReceiptDocument_tenantId_paymentId_createdAt_id_idx" ON "OrderReceiptDocument"("tenantId","paymentId","createdAt" DESC,id);
ALTER TABLE "OrderReceiptDocument" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OrderReceiptDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderReceiptDocument" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY receipt_source_read ON "OrderReceiptDocument" AS RESTRICTIVE FOR SELECT USING(EXISTS(SELECT 1 FROM "OrderReceipt" p WHERE p."tenantId"="OrderReceiptDocument"."tenantId" AND p.id="OrderReceiptDocument"."paymentId" AND p."orderId"="OrderReceiptDocument"."orderId"));
CREATE POLICY receipt_source_insert ON "OrderReceiptDocument" AS RESTRICTIVE FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM "OrderReceipt" p WHERE p."tenantId"="OrderReceiptDocument"."tenantId" AND p.id="OrderReceiptDocument"."paymentId" AND p."orderId"="OrderReceiptDocument"."orderId" AND p.status='POSTED') AND app.record_sharing_allowed("tenantId",'salesOrders',"orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT'));
CREATE TRIGGER receipt_document_immutable BEFORE UPDATE OR DELETE ON "OrderReceiptDocument" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event();

-- A bounded projection for a prospective number. It cannot consume a number,
-- browse another tenant's counter, or confer a business action.
CREATE FUNCTION app.receipt_document_next(t text,k text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT coalesce((SELECT value FROM public."ReceiptDocumentSequence" WHERE "tenantId"=t),0)+1
 WHERE EXISTS(SELECT 1 FROM public."OrderReceipt" p CROSS JOIN LATERAL app.document_source_issuer(t,p."orderId") i WHERE p."tenantId"=t AND p.id=k)
$$;
REVOKE ALL ON FUNCTION app.receipt_document_next(text,text) FROM PUBLIC;

-- Native immutable linkage, numbering and frozen-payment checks. This trigger
-- alone owns the counter; callers never receive counter-table DML privileges.
CREATE FUNCTION app.receipt_document_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE p public."OrderReceipt"%ROWTYPE; s public."SalesOrder"%ROWTYPE; previous public."OrderReceiptDocument"%ROWTYPE;
 issuer text; next_number integer; template public."BusinessDocumentTemplate"%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public."OrderReceipt" WHERE "tenantId"=NEW."tenantId" AND id=NEW."paymentId" AND "orderId"=NEW."orderId";
 SELECT * INTO s FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 IF p.id IS NULL OR p.status<>'POSTED' OR s.status<>'CONFIRMED' OR s.reference IS NULL THEN RAISE EXCEPTION 'Receipts require a posted payment against a confirmed order' USING ERRCODE='23514'; END IF;
 -- Re-read after the order lock shared with payment reversal.
 SELECT * INTO p FROM public."OrderReceipt" WHERE "tenantId"=NEW."tenantId" AND id=NEW."paymentId";
 IF p.status<>'POSTED' THEN RAISE EXCEPTION 'Payment has been reversed' USING ERRCODE='23514'; END IF;
 SELECT company->>'id' INTO issuer FROM app.document_source_issuer(s."tenantId",s.id) WHERE NOT (office->>'archived')::boolean AND NOT (company->>'archived')::boolean;
 IF issuer IS NULL OR NEW."companyId" IS DISTINCT FROM issuer OR NOT app.record_sharing_allowed(NEW."tenantId",'salesOrders',NEW."orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT') THEN RAISE EXCEPTION 'Issuing source is unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO template FROM public."BusinessDocumentTemplate" WHERE "tenantId"=NEW."tenantId" AND "companyId"=issuer AND "providerKey"=NEW."providerKey" ORDER BY version DESC LIMIT 1;
 IF template.version IS DISTINCT FROM NEW."templateVersion" OR NOT coalesce((template.content->>'enabled')::boolean,false) THEN RAISE EXCEPTION 'Prepare the current enabled receipt template' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM public."OrderReceiptDocument" WHERE "tenantId"=NEW."tenantId" AND "paymentId"=p.id ORDER BY version DESC LIMIT 1;
 IF NEW.version<>coalesce(previous.version,0)+1 OR NEW."supersedesId" IS DISTINCT FROM previous.id THEN RAISE EXCEPTION 'Receipt replacement chain changed' USING ERRCODE='23514'; END IF;
 IF previous.id IS NULL THEN
  INSERT INTO public."ReceiptDocumentSequence"("tenantId",value) VALUES(NEW."tenantId",1) ON CONFLICT("tenantId") DO UPDATE SET value="ReceiptDocumentSequence".value+1 RETURNING value INTO next_number;
 ELSE next_number:=previous.sequence; END IF;
 IF NEW.sequence<>next_number OR NEW.reference IS DISTINCT FROM 'RCT/'||lpad(next_number::text,greatest(6,length(next_number::text)),'0')||'/V'||NEW.version::text THEN RAISE EXCEPTION 'Receipt number changed; review a fresh preview' USING ERRCODE='23514'; END IF;
 IF NEW.snapshot->'payload'->>'sourceReference' IS DISTINCT FROM s.reference OR NEW.snapshot->'evidence'->>'paymentId' IS DISTINCT FROM p.id OR NEW.snapshot->'evidence'->>'orderId' IS DISTINCT FROM s.id
  OR (NEW.snapshot->'evidence'->>'amount')::numeric IS DISTINCT FROM p.amount OR NEW.snapshot->'evidence'->>'currency' IS DISTINCT FROM s.currency
  OR NEW.snapshot->'evidence'->>'receivedOn' IS DISTINCT FROM to_char(p."receivedOn",'YYYY-MM-DD') OR NEW.snapshot->'evidence'->>'method' IS DISTINCT FROM p.method OR NEW.snapshot->'evidence'->>'reference' IS DISTINCT FROM p.reference THEN
  RAISE EXCEPTION 'Receipt must retain its exact posted payment evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.receipt_document_chain() FROM PUBLIC;
CREATE TRIGGER receipt_document_chain BEFORE INSERT ON "OrderReceiptDocument" FOR EACH ROW EXECUTE FUNCTION app.receipt_document_chain();
DO $$ DECLARE who text; BEGIN FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
  EXECUTE format('GRANT SELECT,INSERT ON "OrderReceiptDocument" TO %I',who);
  EXECUTE format('GRANT EXECUTE ON FUNCTION app.receipt_document_next(text,text) TO %I',who);
 END IF;
END LOOP; END $$;
-- No old payment, access, profile, allocation, template or source row is changed.
COMMIT;
