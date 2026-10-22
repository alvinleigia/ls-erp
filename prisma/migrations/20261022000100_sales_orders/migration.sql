BEGIN;
CREATE TABLE "SalesOrder" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  id TEXT NOT NULL, "quotationId" TEXT NOT NULL, revision INTEGER NOT NULL,
  title TEXT NOT NULL, "customerName" TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), consideration DECIMAL(18,4) NOT NULL CHECK (consideration >= 0),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenantId",id),
  FOREIGN KEY ("tenantId","quotationId",revision) REFERENCES "CrmQuotationRevision"("tenantId","quotationId",number) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesOrder_active_quotation_key" ON "SalesOrder"("tenantId","quotationId") WHERE status <> 'CANCELLED';
CREATE INDEX "SalesOrder_tenantId_status_createdAt_id_idx" ON "SalesOrder"("tenantId",status,"createdAt" DESC,id);
CREATE INDEX "SalesOrder_tenantId_createdAt_id_idx" ON "SalesOrder"("tenantId","createdAt" DESC,id);
CREATE INDEX "SalesOrder_tenantId_quotationId_revision_idx" ON "SalesOrder"("tenantId","quotationId",revision);
CREATE TABLE "SalesOrderEvent" (
  "tenantId" TEXT NOT NULL, "orderId" TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED')),
  "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId","orderId",version),
  FOREIGN KEY ("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (length(reason)<=2000 AND (status <> 'CANCELLED' OR length(btrim(reason))>0))
);
ALTER TABLE "SalesOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesOrder" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "SalesOrderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesOrderEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesOrderEvent" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
CREATE FUNCTION app.preserve_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' OR NEW.version<>1 THEN RAISE EXCEPTION 'Sales orders must start as drafts'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(OLD)-'status'-'version'-'updatedAt')=(to_jsonb(NEW)-'status'-'version'-'updatedAt')
      AND NEW.version=OLD.version+1
      AND ((OLD.status='DRAFT' AND NEW.status IN ('CONFIRMED','CANCELLED')) OR (OLD.status='CONFIRMED' AND NEW.status='CANCELLED')) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Sales order snapshot is immutable or transition is invalid';
END; $$;
CREATE TRIGGER preserve_sales_order BEFORE INSERT OR UPDATE OR DELETE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order();
CREATE FUNCTION app.preserve_sales_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Sales order history is immutable'; END; $$;
CREATE TRIGGER preserve_sales_order_event BEFORE UPDATE OR DELETE ON "SalesOrderEvent" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event();
-- No existing tenant receives allowance/activation, and no existing rows change.
COMMIT;
