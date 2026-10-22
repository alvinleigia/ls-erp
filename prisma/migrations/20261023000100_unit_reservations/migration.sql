BEGIN;
CREATE TABLE "UnitReservation" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  id TEXT NOT NULL, "orderId" TEXT NOT NULL, "itemId" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL, "itemName" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','ALLOCATED','RELEASED','EXPIRED')),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenantId",id),
  FOREIGN KEY ("tenantId","orderId") REFERENCES "SalesOrder"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("tenantId","itemId") REFERENCES "CatalogItem"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("expiresAt">"createdAt")
);
CREATE UNIQUE INDEX "UnitReservation_active_item_key" ON "UnitReservation"("tenantId","itemId") WHERE status IN ('HELD','ALLOCATED');
CREATE INDEX "UnitReservation_tenantId_orderId_createdAt_id_idx" ON "UnitReservation"("tenantId","orderId","createdAt",id);
CREATE INDEX "UnitReservation_tenantId_itemId_status_expiresAt_idx" ON "UnitReservation"("tenantId","itemId",status,"expiresAt");
CREATE TABLE "UnitReservationEvent" (
  "tenantId" TEXT NOT NULL, "reservationId" TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('HELD','ALLOCATED','RELEASED','EXPIRED')),
  "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId","reservationId",version),
  FOREIGN KEY ("tenantId","reservationId") REFERENCES "UnitReservation"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (length(reason)<=2000 AND (status<>'RELEASED' OR length(btrim(reason))>0))
);
ALTER TABLE "UnitReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitReservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UnitReservation" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "UnitReservationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitReservationEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UnitReservationEvent" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
CREATE FUNCTION app.preserve_unit_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_status TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reservation history must be retained'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT status INTO order_status FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
    PERFORM id FROM "CatalogItem" WHERE "tenantId"=NEW."tenantId" AND id=NEW."itemId" AND kind='UNIT' AND NOT archived AND availability='AVAILABLE' FOR UPDATE;
    IF NOT FOUND OR order_status IS NULL OR order_status='CANCELLED' OR NEW.status<>'HELD' OR NEW.version<>1
      OR NEW."expiresAt"<=clock_timestamp() OR NEW."expiresAt">clock_timestamp()+interval '30 days'
    THEN RAISE EXCEPTION 'Reservation requires an available unit, active order and future expiry within 30 days'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(OLD)-'status'-'version'-'updatedAt')<>(to_jsonb(NEW)-'status'-'version'-'updatedAt') OR NEW.version<>OLD.version+1
    OR NOT ((OLD.status='HELD' AND NEW.status IN ('ALLOCATED','RELEASED','EXPIRED')) OR (OLD.status='ALLOCATED' AND NEW.status='RELEASED'))
  THEN RAISE EXCEPTION 'Reservation snapshot is immutable or transition is invalid'; END IF;
  IF NEW.status='ALLOCATED' THEN
    SELECT status INTO order_status FROM "SalesOrder" WHERE "tenantId"=NEW."tenantId" AND id=NEW."orderId" FOR UPDATE;
    IF order_status IS DISTINCT FROM 'CONFIRMED' OR NEW."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Allocation requires a confirmed order and unexpired hold'; END IF;
  END IF;
  IF NEW.status='EXPIRED' AND NEW."expiresAt">clock_timestamp() THEN RAISE EXCEPTION 'Hold has not expired'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER preserve_unit_reservation BEFORE INSERT OR UPDATE OR DELETE ON "UnitReservation" FOR EACH ROW EXECUTE FUNCTION app.preserve_unit_reservation();
CREATE TRIGGER preserve_unit_reservation_event BEFORE UPDATE OR DELETE ON "UnitReservationEvent" FOR EACH ROW EXECUTE FUNCTION app.preserve_sales_order_event();
-- Guard invariants even if an alternative caller bypasses the application service.
CREATE FUNCTION app.protect_reserved_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "UnitReservation" WHERE "tenantId"=OLD."tenantId" AND "itemId"=OLD.id
    AND (status='ALLOCATED' OR (status='HELD' AND "expiresAt">clock_timestamp())))
  THEN RAISE EXCEPTION 'Release the unit reservation before changing this catalog item'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_reserved_unit BEFORE UPDATE ON "CatalogItem" FOR EACH ROW EXECUTE FUNCTION app.protect_reserved_unit();
CREATE FUNCTION app.protect_reserved_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='CANCELLED' AND EXISTS (SELECT 1 FROM "UnitReservation" WHERE "tenantId"=OLD."tenantId" AND "orderId"=OLD.id AND status IN ('HELD','ALLOCATED'))
  THEN RAISE EXCEPTION 'Release reservations in the order cancellation transaction'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_reserved_order BEFORE UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.protect_reserved_order();
-- No existing records, module flags or role assignments change.
COMMIT;
