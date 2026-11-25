BEGIN;
ALTER TABLE "OrderReceipt"
 ADD COLUMN "bankName" text NOT NULL DEFAULT '',
 ADD COLUMN "transferType" text NOT NULL DEFAULT '',
 ADD CONSTRAINT receipt_bank_details CHECK(length("bankName")<=200 AND
  ("transferType"='' OR (method='BANK_TRANSFER' AND "transferType" IN ('NEFT','RTGS','IMPS','WIRE')) OR (method='CHEQUE' AND "transferType"='DD')));

-- The existing immutable receipt guard covers these columns too. Allocations
-- retain the same tenant/order foreign keys, locking and deferred reconciliation.
-- New balance evidence is checked under the same order lock as payment posting.
CREATE FUNCTION app.receipt_document_balance_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE payment public."OrderReceipt"%ROWTYPE; account public."OrderReceivable"%ROWTYPE;
 received numeric; expected jsonb; evidence jsonb:=NEW.snapshot->'evidence';
BEGIN
 PERFORM id FROM public."SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 SELECT * INTO payment FROM public."OrderReceipt" WHERE "tenantId"=NEW."tenantId" AND id=NEW."paymentId";
 SELECT * INTO account FROM public."OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
 IF payment.id IS NULL OR account."orderId" IS NULL THEN RAISE EXCEPTION 'Receipt financial source is unavailable' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(evidence->'financial') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Prepare receipt balance evidence' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(a.amount),0) INTO received FROM public."OrderReceiptAllocation" a
 JOIN public."OrderReceipt" p ON p."tenantId"=a."tenantId" AND p.id=a."paymentId"
 WHERE a."tenantId"=NEW."tenantId" AND a."orderId"=NEW."orderId" AND p.status='POSTED';
 IF evidence->>'bankName' IS DISTINCT FROM payment."bankName" OR evidence->>'transferType' IS DISTINCT FROM payment."transferType"
  OR (evidence->'financial'->>'version')::integer IS DISTINCT FROM account.version
  OR (evidence->'financial'->>'total')::numeric IS DISTINCT FROM account.total
  OR (evidence->'financial'->>'received')::numeric IS DISTINCT FROM received
  OR (evidence->'financial'->>'outstanding')::numeric IS DISTINCT FROM account.total-received
 THEN RAISE EXCEPTION 'Receipt balance evidence changed; review a fresh preview' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'label',l.label,'amount',a.amount::numeric::text,
   'scheduled',l.amount::numeric::text,'paid',paid.amount::numeric::text,'outstanding',(l.amount-paid.amount)::numeric::text) ORDER BY l.position),'[]'::jsonb)
 INTO expected FROM public."OrderReceiptAllocation" a
 JOIN public."OrderReceivableLine" l ON l."tenantId"=a."tenantId" AND l.id=a."lineId"
 CROSS JOIN LATERAL (SELECT coalesce(sum(x.amount),0) amount FROM public."OrderReceiptAllocation" x
   JOIN public."OrderReceipt" p ON p."tenantId"=x."tenantId" AND p.id=x."paymentId"
   WHERE x."tenantId"=l."tenantId" AND x."orderId"=NEW."orderId" AND x."lineId"=l.id AND p.status='POSTED') paid
 WHERE a."tenantId"=NEW."tenantId" AND a."paymentId"=NEW."paymentId";
 -- Compare numeric JSON values, independent of decimal scale/text formatting.
 IF (SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',x->>'lineId','label',x->>'label','amount',(x->>'amount')::numeric,
    'scheduled',(x->>'scheduled')::numeric,'paid',(x->>'paid')::numeric,'outstanding',(x->>'outstanding')::numeric) ORDER BY ord),'[]'::jsonb)
    FROM jsonb_array_elements(evidence->'allocations') WITH ORDINALITY e(x,ord))
 IS DISTINCT FROM
   (SELECT coalesce(jsonb_agg(jsonb_build_object('lineId',x->>'lineId','label',x->>'label','amount',(x->>'amount')::numeric,
    'scheduled',(x->>'scheduled')::numeric,'paid',(x->>'paid')::numeric,'outstanding',(x->>'outstanding')::numeric) ORDER BY ord),'[]'::jsonb)
    FROM jsonb_array_elements(expected) WITH ORDINALITY e(x,ord))
 THEN RAISE EXCEPTION 'Receipt allocations must retain their exact balance evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.receipt_document_balance_evidence() FROM PUBLIC;
CREATE TRIGGER receipt_document_balance_evidence BEFORE INSERT ON "OrderReceiptDocument"
 FOR EACH ROW EXECUTE FUNCTION app.receipt_document_balance_evidence();
COMMIT;
