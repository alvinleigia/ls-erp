BEGIN;
CREATE TABLE "OrderReceivable" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL, currency TEXT NOT NULL, total DECIMAL(18,4) NOT NULL CHECK (total>0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdBy" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  PRIMARY KEY ("tenantId","orderId"),
  FOREIGN KEY ("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "OrderReceivableLine" (
  "tenantId" TEXT NOT NULL, id TEXT NOT NULL, "orderId" TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 59), label TEXT NOT NULL,
  amount DECIMAL(18,4) NOT NULL CHECK (amount>0), "dueOn" DATE,
  PRIMARY KEY ("tenantId",id), UNIQUE ("tenantId","orderId",id), UNIQUE ("tenantId","orderId",position),
  FOREIGN KEY ("tenantId","orderId") REFERENCES "OrderReceivable"("tenantId","orderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "OrderReceipt" (
  "tenantId" TEXT NOT NULL, id TEXT NOT NULL, "orderId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  amount DECIMAL(18,4) NOT NULL CHECK (amount>0), "receivedOn" DATE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER','UPI','CARD','CASH','CHEQUE','OTHER')),
  reference TEXT NOT NULL DEFAULT '', "referenceKey" TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdBy" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  PRIMARY KEY ("tenantId",id), UNIQUE ("tenantId","orderId",id), UNIQUE ("tenantId","requestKey"),
  FOREIGN KEY ("tenantId","orderId") REFERENCES "OrderReceivable"("tenantId","orderId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (length(reference)<=120 AND "referenceKey"=lower(btrim(reference)) AND (method='CASH' OR length(btrim(reference))>0))
);
CREATE UNIQUE INDEX "OrderReceipt_active_reference_key" ON "OrderReceipt"("tenantId",method,"referenceKey") WHERE status='POSTED' AND "referenceKey"<>'';
CREATE INDEX "OrderReceipt_tenantId_orderId_createdAt_id_idx" ON "OrderReceipt"("tenantId","orderId","createdAt" DESC,id);
CREATE TABLE "OrderReceiptAllocation" (
  "tenantId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "paymentId" TEXT NOT NULL, "lineId" TEXT NOT NULL,
  amount DECIMAL(18,4) NOT NULL CHECK (amount>0), PRIMARY KEY ("tenantId","paymentId","lineId"),
  FOREIGN KEY ("tenantId","orderId","paymentId") REFERENCES "OrderReceipt"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId","orderId","lineId") REFERENCES "OrderReceivableLine"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OrderReceiptAllocation_tenantId_orderId_lineId_idx" ON "OrderReceiptAllocation"("tenantId","orderId","lineId");
CREATE TABLE "OrderReceiptReversal" (
  "tenantId" TEXT NOT NULL, "paymentId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CORRECTION','REFUND')), reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  "effectiveOn" DATE NOT NULL, reference TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdBy" TEXT NOT NULL, "actorName" TEXT NOT NULL,
  PRIMARY KEY ("tenantId","paymentId"), UNIQUE ("tenantId","orderId","paymentId"), UNIQUE ("tenantId","requestKey"),
  FOREIGN KEY ("tenantId","orderId","paymentId") REFERENCES "OrderReceipt"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (length(reference)<=120 AND (kind='CORRECTION' OR length(btrim(reference))>0))
);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['OrderReceivable','OrderReceivableLine','OrderReceipt','OrderReceiptAllocation','OrderReceiptReversal'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"))',t);
  END LOOP;
END; $$;
CREATE FUNCTION app.immutable_receivable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial records must be retained; use a recorded correction or refund'; END; $$;
CREATE TRIGGER immutable_receivable_line BEFORE UPDATE OR DELETE ON "OrderReceivableLine" FOR EACH ROW EXECUTE FUNCTION app.immutable_receivable_record();
CREATE TRIGGER immutable_receipt_allocation BEFORE UPDATE OR DELETE ON "OrderReceiptAllocation" FOR EACH ROW EXECUTE FUNCTION app.immutable_receivable_record();
CREATE TRIGGER immutable_receipt_reversal BEFORE UPDATE OR DELETE ON "OrderReceiptReversal" FOR EACH ROW EXECUTE FUNCTION app.immutable_receivable_record();
CREATE FUNCTION app.guard_order_receivable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "SalesOrder";
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO source FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
    IF source.status IS DISTINCT FROM 'CONFIRMED' OR NEW.currency IS DISTINCT FROM source.currency OR NEW.version<>1
      OR (source.snapshot->'calculation'->>'hasPending')::boolean IS DISTINCT FROM false
      OR NEW.total IS DISTINCT FROM (source.snapshot->'calculation'->>'totalKnown')::numeric
    THEN RAISE EXCEPTION 'Receivables require a confirmed order with resolved saved charges'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.version=OLD.version+1 AND (to_jsonb(NEW)-'version')=(to_jsonb(OLD)-'version') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Receivable terms are immutable';
END; $$;
CREATE TRIGGER guard_order_receivable BEFORE INSERT OR UPDATE OR DELETE ON "OrderReceivable" FOR EACH ROW EXECUTE FUNCTION app.guard_order_receivable();
CREATE FUNCTION app.lock_receivable_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_status TEXT;
BEGIN
  SELECT status INTO order_status FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
  PERFORM "orderId" FROM "OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" FOR UPDATE;
  IF order_status IS DISTINCT FROM 'CONFIRMED' OR NOT FOUND THEN RAISE EXCEPTION 'A confirmed order and open receivable are required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER lock_receivable_line BEFORE INSERT ON "OrderReceivableLine" FOR EACH ROW EXECUTE FUNCTION app.lock_receivable_write();
CREATE TRIGGER lock_receipt BEFORE INSERT ON "OrderReceipt" FOR EACH ROW EXECUTE FUNCTION app.lock_receivable_write();
CREATE TRIGGER lock_receipt_allocation BEFORE INSERT ON "OrderReceiptAllocation" FOR EACH ROW EXECUTE FUNCTION app.lock_receivable_write();
CREATE TRIGGER lock_receipt_reversal BEFORE INSERT ON "OrderReceiptReversal" FOR EACH ROW EXECUTE FUNCTION app.lock_receivable_write();
CREATE FUNCTION app.guard_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.status='POSTED' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='POSTED' AND NEW.status='REVERSED' AND (to_jsonb(OLD)-'status')=(to_jsonb(NEW)-'status')
    AND EXISTS (SELECT 1 FROM "OrderReceiptReversal" WHERE "tenantId"=NEW."tenantId" AND "paymentId"=NEW.id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Receipts are immutable; a reversal must be recorded first';
END; $$;
CREATE TRIGGER guard_receipt BEFORE INSERT OR UPDATE OR DELETE ON "OrderReceipt" FOR EACH ROW EXECUTE FUNCTION app.guard_receipt();
-- Deferred checks allow the service to write account/lines and payment/allocations
-- atomically. Parent row locks serialize competing transactions.
CREATE FUNCTION app.check_receivable_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected NUMERIC; actual NUMERIC;
BEGIN
  SELECT total INTO expected FROM "OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
  SELECT coalesce(sum(amount),0) INTO actual FROM "OrderReceivableLine" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
  IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Receivable lines must reconcile to the saved order total'; END IF;
  IF EXISTS (SELECT 1 FROM "OrderReceipt" p WHERE p."tenantId"=NEW."tenantId" AND p."orderId"=NEW."orderId" AND (
    p.amount<>(SELECT coalesce(sum(a.amount),0) FROM "OrderReceiptAllocation" a WHERE a."tenantId"=p."tenantId" AND a."paymentId"=p.id)
    OR (p.status='REVERSED')<>EXISTS(SELECT 1 FROM "OrderReceiptReversal" r WHERE r."tenantId"=p."tenantId" AND r."paymentId"=p.id)
  )) THEN RAISE EXCEPTION 'Payment allocations or reversal do not reconcile'; END IF;
  IF EXISTS (SELECT 1 FROM "OrderReceivableLine" l WHERE l."tenantId"=NEW."tenantId" AND l."orderId"=NEW."orderId"
    AND l.amount<(SELECT coalesce(sum(a.amount),0) FROM "OrderReceiptAllocation" a JOIN "OrderReceipt" p ON p."tenantId"=a."tenantId" AND p.id=a."paymentId"
      WHERE a."tenantId"=l."tenantId" AND a."lineId"=l.id AND p.status='POSTED')) THEN RAISE EXCEPTION 'A receivable cannot be overpaid'; END IF;
  IF EXISTS (SELECT 1 FROM "OrderReceiptReversal" r JOIN "OrderReceipt" p ON p."tenantId"=r."tenantId" AND p.id=r."paymentId"
    WHERE r."tenantId"=NEW."tenantId" AND r."orderId"=NEW."orderId" AND r."effectiveOn"<p."receivedOn") THEN RAISE EXCEPTION 'Reversal cannot predate payment'; END IF;
  RETURN NULL;
END; $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['OrderReceivable','OrderReceivableLine','OrderReceipt','OrderReceiptAllocation','OrderReceiptReversal'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER reconcile_receivables AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_receivable_totals()',t);
  END LOOP;
END; $$;
CREATE FUNCTION app.protect_paid_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='CANCELLED' AND EXISTS (SELECT 1 FROM "OrderReceipt" WHERE "tenantId"=OLD."tenantId" AND "orderId"=OLD.id AND status='POSTED')
  THEN RAISE EXCEPTION 'Resolve recorded payments before cancelling the order'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_paid_order BEFORE UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.protect_paid_order();
-- Existing data, role assignments and tenant activation are unchanged.
COMMIT;
