BEGIN;
-- Accepted quotation/order snapshots and all existing schedule/payment rows stay
-- untouched. A pending extra is priced exactly once, as an append-only addition.
CREATE TABLE "OrderReceivableCharge" (
 "tenantId" text NOT NULL, id text NOT NULL, "orderId" text NOT NULL,
 "sourceKey" text NOT NULL CHECK("sourceKey" ~ '^charge:(0|[1-9][0-9]{0,2})$'),
 label text NOT NULL, amount decimal(18,4) NOT NULL CHECK(amount>=0), "dueOn" date, "lineId" text,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), "requestKey" text NOT NULL, "accountVersion" integer NOT NULL CHECK("accountVersion">1),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdBy" text NOT NULL, "actorName" text NOT NULL,
 PRIMARY KEY("tenantId",id), UNIQUE("tenantId","orderId","sourceKey"), UNIQUE("tenantId","orderId","lineId"), UNIQUE("tenantId","requestKey"),
 FOREIGN KEY("tenantId","orderId") REFERENCES "OrderReceivable"("tenantId","orderId") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","orderId","lineId") REFERENCES "OrderReceivableLine"("tenantId","orderId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK((amount=0 AND "lineId" IS NULL) OR (amount>0 AND "lineId" IS NOT NULL))
);
ALTER TABLE "OrderReceivableCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderReceivableCharge" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderReceivableCharge" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY office_source ON "OrderReceivableCharge" AS RESTRICTIVE FOR ALL
 USING(app.record_office_allowed("tenantId",'salesOrders',"orderId",nullif(current_setting('app.actor_id',true),'')));
CREATE POLICY record_sharing_read ON "OrderReceivableCharge" AS RESTRICTIVE FOR SELECT
 USING(app.record_sharing_allowed("tenantId",'salesOrders',"orderId",coalesce(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "OrderReceivableCharge" AS RESTRICTIVE FOR INSERT
 WITH CHECK(app.record_sharing_allowed("tenantId",'salesOrders',"orderId",coalesce(current_setting('app.actor_id',true),''),'EDIT'));
-- Retain the deployed runtime role grants; no new role or access assignment.
DO $$ DECLARE g record; BEGIN
 FOR g IN SELECT DISTINCT grantee,privilege_type FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='OrderReceivable' AND grantee<>current_user
   AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE') LOOP
  EXECUTE format('GRANT %s ON "OrderReceivableCharge" TO %I',g.privilege_type,g.grantee);
 END LOOP;
END $$;
CREATE TRIGGER immutable_receivable_charge BEFORE UPDATE OR DELETE ON "OrderReceivableCharge"
 FOR EACH ROW EXECUTE FUNCTION app.immutable_receivable_record();
CREATE TRIGGER lock_receivable_charge BEFORE INSERT ON "OrderReceivableCharge"
 FOR EACH ROW EXECUTE FUNCTION app.lock_receivable_write();

CREATE FUNCTION app.guard_receivable_charge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb; charge jsonb; line "OrderReceivableLine"; digits integer; base_lines integer; additions integer; current_version integer;
BEGIN
 SELECT snapshot INTO s FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 charge:=s->'calculation'->'charges'->(split_part(NEW."sourceKey",':',2)::integer);
 digits:=length(split_part(s->'calculation'->>'totalKnown','.',2));
 SELECT version INTO current_version FROM "OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
 IF charge IS NULL OR charge->>'kind' IS DISTINCT FROM 'TBD' OR charge->>'included' IS DISTINCT FROM 'false'
  OR charge->'amount' IS DISTINCT FROM 'null'::jsonb OR charge->>'label' IS DISTINCT FROM NEW.label
  OR round(NEW.amount,digits)<>NEW.amount OR NEW."accountVersion" IS DISTINCT FROM current_version+1 THEN
  RAISE EXCEPTION 'Confirm only an unpriced saved extra in the order currency precision';
 END IF;
 IF NEW.amount>0 THEN
  SELECT * INTO line FROM "OrderReceivableLine" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" AND id=NEW."lineId";
  SELECT count(*) INTO base_lines FROM jsonb_array_elements(CASE WHEN jsonb_array_length(s->'calculation'->'instalments')>0
   THEN s->'calculation'->'instalments' ELSE jsonb_build_array(jsonb_build_object('amount',s->'calculation'->>'consideration')) END) r WHERE (r->>'amount')::numeric>0;
  SELECT base_lines+count(*) INTO base_lines FROM jsonb_array_elements(s->'calculation'->'charges') r
   WHERE (r->>'included')::boolean=false AND (r->>'amount')::numeric>0;
  SELECT count(*) INTO additions FROM "OrderReceivableCharge" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" AND amount>0;
  IF line.id IS NULL OR line.position<>base_lines+additions OR line.label IS DISTINCT FROM NEW.label OR line.amount<>NEW.amount OR line."dueOn" IS DISTINCT FROM NEW."dueOn" THEN
   RAISE EXCEPTION 'Confirmed charge must match its new schedule line';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_receivable_charge() FROM PUBLIC;
CREATE TRIGGER guard_receivable_charge BEFORE INSERT ON "OrderReceivableCharge"
 FOR EACH ROW EXECUTE FUNCTION app.guard_receivable_charge();

CREATE OR REPLACE FUNCTION app.guard_order_receivable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "SalesOrder"; expected numeric;
BEGIN
 SELECT * INTO source FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF source.status IS DISTINCT FROM 'CONFIRMED' OR NEW.currency IS DISTINCT FROM source.currency OR NEW.version<>1
   OR NEW.total IS DISTINCT FROM (source.snapshot->'calculation'->>'totalKnown')::numeric THEN
   RAISE EXCEPTION 'Receivables require the known total of a confirmed order';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.version=OLD.version+1
  AND (to_jsonb(NEW)-ARRAY['version','total'])=(to_jsonb(OLD)-ARRAY['version','total']) THEN
  SELECT (source.snapshot->'calculation'->>'totalKnown')::numeric+coalesce(sum(amount),0) INTO expected
   FROM "OrderReceivableCharge" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId";
  IF NEW.total=expected THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Receivable terms are immutable; total changes require saved charge confirmations';
END $$;
CREATE CONSTRAINT TRIGGER reconcile_receivables AFTER INSERT ON "OrderReceivableCharge"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_receivable_totals();
CREATE FUNCTION app.check_receivable_charge_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "OrderReceivable" WHERE "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" AND version>=NEW."accountVersion") THEN
  RAISE EXCEPTION 'Charge confirmation must advance the balance version';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app.check_receivable_charge_version() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER reconcile_receivable_charge_version AFTER INSERT ON "OrderReceivableCharge"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_receivable_charge_version();
COMMIT;
