-- Optional association only. Existing activities and financial records are retained.
ALTER TABLE "CrmTask" ADD COLUMN "collectionOrderId" TEXT;
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_collection_receivable_fkey"
  FOREIGN KEY ("tenantId", "collectionOrderId") REFERENCES "OrderReceivable"("tenantId", "orderId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CrmTask_tenantId_collectionOrderId_status_dueOn_idx" ON "CrmTask"("tenantId", "collectionOrderId", status, "dueOn");
CREATE FUNCTION guard_collection_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."collectionOrderId" IS DISTINCT FROM OLD."collectionOrderId" THEN
    RAISE EXCEPTION 'Collection association is immutable';
  END IF;
  IF NEW."collectionOrderId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "SalesOrder" o JOIN "CrmQuotation" q ON q."tenantId"=o."tenantId" AND q.id=o."quotationId"
    JOIN "CrmOpportunity" p ON p."tenantId"=q."tenantId" AND p.id=q."opportunityId"
    WHERE o."tenantId"=NEW."tenantId" AND o.id=NEW."collectionOrderId"
      AND p.id=NEW."opportunityId" AND p."contactId"=NEW."contactId" AND NEW."enquiryId" IS NULL
  ) THEN RAISE EXCEPTION 'Collection activity must match its order customer and opportunity'; END IF;
  IF NEW."followUpOfId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "CrmTask" t WHERE t."tenantId"=NEW."tenantId" AND t.id=NEW."followUpOfId"
      AND t."collectionOrderId" IS DISTINCT FROM NEW."collectionOrderId"
  ) THEN RAISE EXCEPTION 'Follow-up must retain its collection association'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER collection_work_guard BEFORE INSERT OR UPDATE ON "CrmTask"
  FOR EACH ROW EXECUTE FUNCTION guard_collection_work();
