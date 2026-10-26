-- Phase 2D6B1 rehearsal candidate. NOT part of prisma migrate deploy.
-- Promote only with the matching Prisma/service/UI cutover, after its tests pass.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Inventory ownership requires BYPASSRLS'; END IF;
 IF EXISTS(SELECT 1 FROM "InventoryProduct" p JOIN "InventoryCategory" c ON c.id=p."categoryId" WHERE c."tenantId" IS NULL OR (p."tenantId" IS NOT NULL AND p."tenantId" IS DISTINCT FROM c."tenantId")) THEN RAISE EXCEPTION 'Inventory historical tenant relations disagree'; END IF;
 IF EXISTS(SELECT 1 FROM "PurchaseOrder" p JOIN "Supplier" s ON s.id=p."supplierId" WHERE s."tenantId" IS NULL OR (p."tenantId" IS NOT NULL AND p."tenantId" IS DISTINCT FROM s."tenantId")) THEN RAISE EXCEPTION 'Purchase historical tenant relations disagree'; END IF;
END $$;
UPDATE "InventoryProduct" p SET "tenantId"=c."tenantId" FROM "InventoryCategory" c WHERE c.id=p."categoryId" AND p."tenantId" IS NULL;
UPDATE "PurchaseOrder" p SET "tenantId"=s."tenantId" FROM "Supplier" s WHERE s.id=p."supplierId" AND p."tenantId" IS NULL;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "InventoryProductSupplier" l JOIN "InventoryProduct" p ON p.id=l."productId" JOIN "Supplier" s ON s.id=l."supplierId" WHERE p."tenantId" IS DISTINCT FROM s."tenantId") OR EXISTS(SELECT 1 FROM "InventoryProductTax" l JOIN "InventoryProduct" p ON p.id=l."productId" JOIN "Tax" t ON t.id=l."taxId" WHERE p."tenantId" IS DISTINCT FROM t."tenantId") OR EXISTS(SELECT 1 FROM "PurchaseOrderItem" l JOIN "PurchaseOrder" o ON o.id=l."orderId" JOIN "InventoryProduct" p ON p.id=l."productId" WHERE o."tenantId" IS DISTINCT FROM p."tenantId") OR EXISTS(SELECT 1 FROM "AppointmentOrderProductLine" l JOIN "AppointmentOrder" o ON o.id=l."orderId" JOIN "InventoryProduct" p ON p.id=l."productId" WHERE o."tenantId" IS DISTINCT FROM p."tenantId") THEN RAISE EXCEPTION 'Inventory historical source relations disagree'; END IF;
 IF EXISTS(SELECT 1 FROM "InventoryStockMovement" m JOIN "InventoryProduct" p ON p.id=m."productId" LEFT JOIN "PurchaseOrderItem" i ON i.id=m."orderItemId" LEFT JOIN "PurchaseOrder" o ON o.id=i."orderId" WHERE (m."tenantId" IS NOT NULL AND m."tenantId" IS DISTINCT FROM p."tenantId") OR (i.id IS NOT NULL AND (i."productId" IS DISTINCT FROM p.id OR o."tenantId" IS DISTINCT FROM p."tenantId"))) THEN RAISE EXCEPTION 'Inventory historical movement relations disagree'; END IF;
 IF EXISTS(SELECT 1 FROM "InventoryProduct" WHERE "onHandQty"<0 OR "costPriceCents"<0 OR "reorderPoint"<0 OR "reorderQty"<0) OR EXISTS(SELECT 1 FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" o ON o.id=i."orderId" WHERE i.quantity<=0 OR i."receivedQty"<0 OR i."receivedQty">i.quantity OR i."unitCostCents"<0 OR (o.status='RECEIVED' AND i."receivedQty"<>i.quantity)) OR EXISTS(SELECT 1 FROM "AppointmentOrderProductLine" WHERE quantity<=0) THEN RAISE EXCEPTION 'Inventory historical quantities require reconciliation'; END IF;
 -- A global historical quantity cannot be allocated to multiple offices by guesswork.
 IF EXISTS(SELECT 1 FROM "AppointmentOrderProductLine" l JOIN "AppointmentOrder" o ON o.id=l."orderId" JOIN "BusinessOffice" b ON b.id=o."officeId" WHERE o.status IN ('CONFIRMED','COMPLETED') AND NOT b."isInitial") THEN RAISE EXCEPTION 'Inventory historical office allocation requires reconciliation'; END IF;
END $$;
UPDATE "InventoryStockMovement" m SET "tenantId"=p."tenantId" FROM "InventoryProduct" p WHERE p.id=m."productId" AND m."tenantId" IS NULL;
ALTER TABLE "InventoryProduct" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "InventoryStockMovement" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE UNIQUE INDEX "InventoryProduct_tenantId_id_key" ON "InventoryProduct"("tenantId",id);
ALTER TABLE "PurchaseOrder" ADD COLUMN "officeId" text;
UPDATE "PurchaseOrder" p SET "officeId"=o.id FROM "BusinessOffice" o WHERE o."tenantId"=p."tenantId" AND o."isInitial";
ALTER TABLE "PurchaseOrder" ALTER COLUMN "officeId" SET NOT NULL, ALTER COLUMN "officeId" SET DEFAULT app.creation_office_id();
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "PurchaseOrder_tenantId_officeId_idx" ON "PurchaseOrder"("tenantId","officeId");
ALTER TABLE "InventoryStockMovement" ADD COLUMN "officeId" text, ADD COLUMN "bookingOrderId" text;
UPDATE "InventoryStockMovement" m SET "officeId"=o.id FROM "BusinessOffice" o WHERE o."tenantId"=m."tenantId" AND o."isInitial";
-- Resolve only exact known booking notes, with matching tenant AND product.
UPDATE "InventoryStockMovement" m SET "bookingOrderId"=o.id,"officeId"=o."officeId" FROM "AppointmentOrder" o WHERE o."tenantId"=m."tenantId" AND m.type IN ('BOOKING_PRODUCT_SALE','BOOKING_PRODUCT_RESTOCK') AND m.note IN ('Booking order '||o.id||' stock deduction','Booking order '||o.id||' stock restore') AND EXISTS(SELECT 1 FROM "AppointmentOrderProductLine" l WHERE l."orderId"=o.id AND l."productId"=m."productId");
ALTER TABLE "InventoryStockMovement" ALTER COLUMN "officeId" SET NOT NULL;
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_tenantId_officeId_fkey" FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "InventoryStockMovement" ADD CONSTRAINT "InventoryStockMovement_bookingOrderId_fkey" FOREIGN KEY("bookingOrderId") REFERENCES "AppointmentOrder"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InventoryStockMovement_tenantId_officeId_idx" ON "InventoryStockMovement"("tenantId","officeId");
CREATE TABLE "InventoryOfficeStock" (
 "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "officeId" text NOT NULL, "productId" text NOT NULL,
 "onHandQty" integer NOT NULL DEFAULT 0 CHECK("onHandQty">=0),
 "costPriceCents" integer NOT NULL DEFAULT 0 CHECK("costPriceCents">=0),
 "reorderPoint" integer NOT NULL DEFAULT 0 CHECK("reorderPoint">=0),
 "reorderQty" integer NOT NULL DEFAULT 0 CHECK("reorderQty">=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamp(3) NOT NULL,
 PRIMARY KEY("officeId","productId"),
 FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","productId") REFERENCES "InventoryProduct"("tenantId",id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InventoryOfficeStock_tenantId_officeId_idx" ON "InventoryOfficeStock"("tenantId","officeId");
-- Current quantity is authoritative: do not sum incomplete historical movements.
INSERT INTO "InventoryOfficeStock"("tenantId","officeId","productId","onHandQty","costPriceCents","reorderPoint","reorderQty","createdAt","updatedAt") SELECT p."tenantId",o.id,p.id,p."onHandQty",p."costPriceCents",p."reorderPoint",p."reorderQty",p."createdAt",p."updatedAt" FROM "InventoryProduct" p JOIN "BusinessOffice" o ON o."tenantId"=p."tenantId" AND o."isInitial";
DO $$ BEGIN IF (SELECT count(*) FROM "InventoryOfficeStock")<>(SELECT count(*) FROM "InventoryProduct") THEN RAISE EXCEPTION 'Inventory initial office is missing'; END IF; END $$;
CREATE TABLE "InventoryBookingStock" (
 "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "officeId" text NOT NULL,"orderId" text NOT NULL REFERENCES "AppointmentOrder"(id) ON DELETE CASCADE ON UPDATE CASCADE,"productId" text NOT NULL,
 quantity integer NOT NULL DEFAULT 0 CHECK(quantity>=0),PRIMARY KEY("orderId","productId"),
 FOREIGN KEY("tenantId","officeId") REFERENCES "BusinessOffice"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","productId") REFERENCES "InventoryProduct"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InventoryBookingStock_tenantId_officeId_idx" ON "InventoryBookingStock"("tenantId","officeId");
INSERT INTO "InventoryBookingStock" SELECT o."tenantId",o."officeId",o.id,l."productId",sum(l.quantity)::integer FROM "AppointmentOrder" o JOIN "AppointmentOrderProductLine" l ON l."orderId"=o.id WHERE o.status IN ('CONFIRMED','COMPLETED') GROUP BY o.id,l."productId";
CREATE TABLE "InventoryReceiptStock" ("itemId" text PRIMARY KEY REFERENCES "PurchaseOrderItem"(id) ON DELETE CASCADE ON UPDATE CASCADE,"tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE ON UPDATE CASCADE,quantity integer NOT NULL DEFAULT 0 CHECK(quantity>=0));
CREATE INDEX "InventoryReceiptStock_tenantId_idx" ON "InventoryReceiptStock"("tenantId");
INSERT INTO "InventoryReceiptStock" SELECT i.id,o."tenantId",i."receivedQty" FROM "PurchaseOrderItem" i JOIN "PurchaseOrder" o ON o.id=i."orderId";
ALTER TABLE "InventoryProduct" DROP COLUMN "onHandQty",DROP COLUMN "costPriceCents",DROP COLUMN "reorderPoint",DROP COLUMN "reorderQty";

CREATE FUNCTION app.inventory_capability(t text,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT t=nullif(current_setting('app.tenant_id',true),'') AND p=ANY(ARRAY['inventoryProducts.read','inventoryProducts.create','inventoryProducts.edit','inventoryProducts.archive','inventoryPurchases.read','inventoryPurchases.create','inventoryPurchases.edit']) AND EXISTS(
 SELECT 1 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId" JOIN public."TenantModule" m ON m."tenantId"=tenant.id AND m.key='inventory' AND m.allowed AND m.enabled WHERE tenant.id=t AND tenant.status='ACTIVE' AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND u.role IN ('ADMIN','MANAGER','STAFF') AND (u.role='ADMIN' OR EXISTS(
 SELECT 1 FROM public."TenantUserAccess" policy WHERE policy."tenantId"=t AND policy."userId"=u.id AND policy.rules->>p='ALL' AND policy.rules->>(split_part(p,'.',1)||'.read')='ALL'
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND p=ANY(r.permissions))
 AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" a JOIN public."TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" AND NOT r.archived WHERE a."tenantId"=t AND a."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions)))))
$$;
REVOKE ALL ON FUNCTION app.inventory_capability(text,text) FROM PUBLIC;
CREATE FUNCTION app.inventory_catalogue_read(t text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT app.inventory_capability(t,'inventoryProducts.read')
$$;
CREATE FUNCTION app.inventory_office_read(t text,o text,resource text DEFAULT 'inventoryProducts') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT resource IN ('inventoryProducts','inventoryPurchases') AND app.inventory_capability(t,resource||'.read') AND app.business_office_access(t,o,nullif(current_setting('app.actor_id',true),''))
$$;
CREATE FUNCTION app.inventory_purchase_read(k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."PurchaseOrder" o WHERE o.id=k AND app.inventory_office_read(o."tenantId",o."officeId",'inventoryPurchases'))
$$;
CREATE FUNCTION app.inventory_creation_office(t text,resource text) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o text:=app.creation_office_id();u text:=nullif(current_setting('app.actor_id',true),''); BEGIN
 IF resource NOT IN ('inventoryProducts','inventoryPurchases') OR NOT COALESCE(app.inventory_capability(t,resource||'.create'),false) OR o IS NULL OR nullif(current_setting('app.office_version',true),'') IS NULL THEN RAISE EXCEPTION 'Select an office and reload the creation form' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."BusinessOfficePolicy" p WHERE p."tenantId"=t AND p."userId"=u AND p."creationOfficeId"=o AND p.version::text=current_setting('app.office_version',true)) THEN RAISE EXCEPTION 'Office context changed; reload the creation form' USING ERRCODE='40001';END IF;
 IF NOT app.business_office_allowed(t,o,u) THEN RAISE EXCEPTION 'Inventory office access is not permitted' USING ERRCODE='42501';END IF;RETURN o;
END $$;
CREATE FUNCTION app.inventory_read_office(t text,requested text DEFAULT NULL) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE o text:=requested; BEGIN
 IF o IS NULL THEN SELECT "creationOfficeId" INTO o FROM public."BusinessOfficePolicy" WHERE "tenantId"=t AND "userId"=nullif(current_setting('app.actor_id',true),'');END IF;
 IF o IS NULL OR NOT COALESCE(app.inventory_office_read(t,o),false) THEN RAISE EXCEPTION 'Inventory stock office selection is required' USING ERRCODE='42501';END IF;RETURN o;
END $$;
CREATE FUNCTION app.inventory_office_label(t text,o text,resource text DEFAULT 'inventoryProducts') RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT jsonb_build_object('id',b.id,'name',b.name,'companyName',c.name,'active',NOT b.archived AND NOT c.archived) FROM public."BusinessOffice" b JOIN public."BusinessCompany" c ON c."tenantId"=b."tenantId" AND c.id=b."companyId" WHERE b."tenantId"=t AND b.id=o AND app.inventory_office_read(t,o,resource)
$$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['InventoryOfficeStock','InventoryBookingStock','InventoryReceiptStock'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY maintenance ON %I FOR ALL USING(current_setting(''app.rls_bypass'',true)=''on'') WITH CHECK(current_setting(''app.rls_bypass'',true)=''on'')',tbl);
 END LOOP;
END $$;
CREATE POLICY office_read ON "InventoryOfficeStock" FOR SELECT USING(app.inventory_office_read("tenantId","officeId"));
CREATE POLICY source_read ON "InventoryBookingStock" FOR SELECT USING(app.inventory_office_read("tenantId","officeId") AND app.booking_order_read("orderId"));
CREATE POLICY source_read ON "InventoryReceiptStock" FOR SELECT USING(EXISTS(SELECT 1 FROM "PurchaseOrderItem" i WHERE i.id="itemId" AND app.inventory_purchase_read(i."orderId")));
CREATE POLICY inventory_office ON "PurchaseOrder" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.inventory_office_read("tenantId","officeId",'inventoryPurchases')) WITH CHECK(current_setting('app.rls_bypass',true)='on' OR app.inventory_office_read("tenantId","officeId",'inventoryPurchases'));
CREATE POLICY inventory_office ON "PurchaseOrderItem" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.inventory_purchase_read("orderId")) WITH CHECK(current_setting('app.rls_bypass',true)='on' OR app.inventory_purchase_read("orderId"));
CREATE POLICY inventory_catalogue ON "InventoryProduct" AS RESTRICTIVE FOR ALL USING(current_setting('app.rls_bypass',true)='on' OR app.inventory_catalogue_read("tenantId")) WITH CHECK(current_setting('app.rls_bypass',true)='on' OR app.inventory_catalogue_read("tenantId"));
CREATE POLICY inventory_office ON "InventoryStockMovement" AS RESTRICTIVE FOR SELECT USING(current_setting('app.rls_bypass',true)='on' OR app.inventory_office_read("tenantId","officeId"));
CREATE POLICY posting_only_insert ON "InventoryStockMovement" AS RESTRICTIVE FOR INSERT WITH CHECK(current_setting('app.rls_bypass',true)='on');
CREATE POLICY posting_only_update ON "InventoryStockMovement" AS RESTRICTIVE FOR UPDATE USING(current_setting('app.rls_bypass',true)='on');
CREATE POLICY posting_only_delete ON "InventoryStockMovement" AS RESTRICTIVE FOR DELETE USING(current_setting('app.rls_bypass',true)='on');

-- Preserve complete old audit snapshots, but scope operational values to their
-- original office. New shared catalogue snapshots contain no stock fields.
UPDATE "AuditLog" a SET metadata=COALESCE(a.metadata,'{}'::jsonb)||jsonb_build_object('officeId',o.id,'officeFamily','inventory') FROM "BusinessOffice" o WHERE o."tenantId"=a."tenantId" AND o."isInitial" AND (a."entityType"='inventoryPurchases' OR (a."entityType"='inventoryProducts' AND (COALESCE(a.before,'{}'::jsonb) ?| ARRAY['onHandQty','costPriceCents','reorderPoint','reorderQty'] OR COALESCE(a.after,'{}'::jsonb) ?| ARRAY['onHandQty','costPriceCents','reorderPoint','reorderQty'])));
CREATE POLICY inventory_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING(
 current_setting('app.rls_bypass',true)='on' OR CASE WHEN "entityType"='inventoryPurchases' THEN app.inventory_office_read("tenantId",metadata->>'officeId','inventoryPurchases') WHEN event LIKE 'inventory.stock.%' OR metadata->>'officeFamily'='inventory' THEN app.inventory_office_read("tenantId",metadata->>'officeId') ELSE true END);

CREATE FUNCTION app.inventory_stock_audit(t text,o text,p text,before_row jsonb,after_row jsonb,request_id text) RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId",metadata,before,after)
 SELECT gen_random_uuid()::text,t,'inventory.stock.updated','inventoryStock',p,u.id,u.role,request_id,jsonb_build_object('officeId',o,'officeFamily','inventory','productId',p),before_row,after_row FROM public."User" u WHERE u.id=nullif(current_setting('app.actor_id',true),'') AND u."tenantId"=t
$$;
REVOKE ALL ON FUNCTION app.inventory_stock_audit(text,text,text,jsonb,jsonb,text) FROM PUBLIC;
-- Private primitive: only validated public commands below may post stock.
CREATE FUNCTION app.inventory_move(t text,o text,p text,delta integer,kind "StockMovementType",cost integer,note_text text,booking text,item text,request_id text,audit_event boolean DEFAULT true) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE prior jsonb;after_row jsonb; BEGIN
 SELECT to_jsonb(s) INTO prior FROM public."InventoryOfficeStock" s WHERE s."tenantId"=t AND s."officeId"=o AND s."productId"=p;
 IF NOT EXISTS(SELECT 1 FROM public."InventoryProduct" WHERE "tenantId"=t AND id=p) OR delta IS NULL OR (cost IS NOT NULL AND cost<0) THEN RAISE EXCEPTION 'Inventory stock source is not permitted' USING ERRCODE='23514';END IF;
 IF COALESCE((prior->>'onHandQty')::integer,0)::bigint+delta<0 THEN RAISE EXCEPTION 'Insufficient stock in the source office' USING ERRCODE='23514';END IF;
 INSERT INTO public."InventoryOfficeStock"("tenantId","officeId","productId","onHandQty","costPriceCents","updatedAt") VALUES(t,o,p,COALESCE((prior->>'onHandQty')::integer,0)+delta,COALESCE(cost,(prior->>'costPriceCents')::integer,0),now()) ON CONFLICT("officeId","productId") DO UPDATE SET "onHandQty"=excluded."onHandQty","costPriceCents"=excluded."costPriceCents",version="InventoryOfficeStock".version+1,"updatedAt"=now();
 IF delta<>0 THEN INSERT INTO public."InventoryStockMovement"(id,"tenantId","officeId","productId",type,"quantityDelta","unitCostCents",note,"bookingOrderId","orderItemId") VALUES(gen_random_uuid()::text,t,o,p,kind,delta,cost,note_text,booking,item);END IF;
 SELECT to_jsonb(s) INTO after_row FROM public."InventoryOfficeStock" s WHERE s."tenantId"=t AND s."officeId"=o AND s."productId"=p;
 IF audit_event THEN PERFORM app.inventory_stock_audit(t,o,p,prior,after_row,request_id);END IF;
END $$;
REVOKE ALL ON FUNCTION app.inventory_move(text,text,text,integer,"StockMovementType",integer,text,text,text,text,boolean) FROM PUBLIC;
CREATE FUNCTION app.inventory_set_stock(t text,o text,p text,qty integer,cost integer,reorder integer,reorder_qty integer,expected_version integer,request_id text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 DECLARE old_row public."InventoryOfficeStock";v integer;prior jsonb;fresh boolean; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 SELECT xmin::text::bigint=mod(txid_current(),4294967296) INTO fresh FROM public."InventoryProduct" WHERE "tenantId"=t AND id=p;
 IF NOT COALESCE(CASE WHEN current_setting('app.inventory_operation',true)='inventoryProducts.create' THEN app.inventory_capability(t,'inventoryProducts.create') AND fresh AND o=app.inventory_creation_office(t,'inventoryProducts') ELSE app.inventory_capability(t,'inventoryProducts.edit') END,false) OR NOT COALESCE(app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Inventory office access is not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO old_row FROM public."InventoryOfficeStock" WHERE "tenantId"=t AND "officeId"=o AND "productId"=p FOR UPDATE;
 IF expected_version IS NULL OR expected_version<>COALESCE(old_row.version,0) THEN RAISE EXCEPTION 'Stock changed; refresh before saving' USING ERRCODE='40001';END IF;
 IF qty<0 OR cost<0 OR reorder<0 OR reorder_qty<0 THEN RAISE EXCEPTION 'Inventory stock values must be nonnegative' USING ERRCODE='23514';END IF;
 prior:=CASE WHEN old_row."productId" IS NULL THEN NULL ELSE to_jsonb(old_row) END;
 PERFORM app.inventory_move(t,o,p,COALESCE(qty,old_row."onHandQty",0)-COALESCE(old_row."onHandQty",0),CASE WHEN COALESCE(qty,old_row."onHandQty",0)>=COALESCE(old_row."onHandQty",0) THEN 'ADJUSTMENT_ADD'::"StockMovementType" ELSE 'ADJUSTMENT_SUB'::"StockMovementType" END,cost,'Stock count correction',NULL,NULL,request_id,false);
 -- One final audit includes reorder settings as well as the actual count/cost.
 UPDATE public."InventoryOfficeStock" SET "reorderPoint"=COALESCE(reorder,"reorderPoint"),"reorderQty"=COALESCE(reorder_qty,"reorderQty") WHERE "tenantId"=t AND "officeId"=o AND "productId"=p RETURNING version INTO v;
 -- Exactly one audit contains the complete count/cost/reorder result.
 PERFORM app.inventory_stock_audit(t,o,p,prior,(SELECT to_jsonb(s) FROM public."InventoryOfficeStock" s WHERE s."officeId"=o AND s."productId"=p),request_id);
 RETURN v;
END $$;
CREATE FUNCTION app.inventory_post_booking(t text,k text,request_id text DEFAULT NULL) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off SET jit=off AS $$
DECLARE source public."AppointmentOrder";r record;op text:=current_setting('app.appointment_operation',true); BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 SELECT * INTO source FROM public."AppointmentOrder" WHERE "tenantId"=t AND id=k FOR UPDATE;
 IF source.id IS NULL OR NOT COALESCE(app.inventory_capability(t,'inventoryProducts.edit') AND app.booking_order_read(k) AND app.booking_capability(t,op) AND op IN ('appointments.create','appointments.edit','appointments.archive') AND app.business_office_allowed(t,source."officeId",nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Inventory booking posting is not permitted' USING ERRCODE='42501';END IF;
 FOR r IN SELECT p.id,COALESCE(s.quantity,0) previous,CASE WHEN source.status IN ('CONFIRMED','COMPLETED') THEN COALESCE(l.qty,0) ELSE 0 END desired FROM public."InventoryProduct" p LEFT JOIN public."InventoryBookingStock" s ON s."orderId"=k AND s."productId"=p.id LEFT JOIN (SELECT "productId",sum(quantity)::integer qty FROM public."AppointmentOrderProductLine" WHERE "orderId"=k GROUP BY "productId") l ON l."productId"=p.id WHERE p."tenantId"=t AND (s."productId" IS NOT NULL OR l."productId" IS NOT NULL) ORDER BY p.id LOOP
  IF r.previous<>r.desired THEN
   PERFORM app.inventory_move(t,source."officeId",r.id,r.previous-r.desired,CASE WHEN r.previous<r.desired THEN 'BOOKING_PRODUCT_SALE'::"StockMovementType" ELSE 'BOOKING_PRODUCT_RESTOCK'::"StockMovementType" END,NULL,'Booking stock posting',k,NULL,request_id);
   INSERT INTO public."InventoryBookingStock" VALUES(t,source."officeId",k,r.id,r.desired) ON CONFLICT("orderId","productId") DO UPDATE SET quantity=excluded.quantity;
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION app.inventory_post_receipt(t text,k text,request_id text DEFAULT NULL) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off SET jit=off AS $$
DECLARE source public."PurchaseOrder";r record;fresh boolean; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 SELECT * INTO source FROM public."PurchaseOrder" WHERE "tenantId"=t AND id=k FOR UPDATE;
 SELECT xmin::text::bigint=mod(txid_current(),4294967296) INTO fresh FROM public."PurchaseOrder" WHERE "tenantId"=t AND id=k;
 IF source.id IS NULL OR source.status<>'RECEIVED' OR NOT COALESCE(app.inventory_capability(t,'inventoryProducts.edit') AND (app.inventory_capability(t,'inventoryPurchases.edit') OR (fresh AND current_setting('app.inventory_operation',true)='inventoryPurchases.create' AND app.inventory_capability(t,'inventoryPurchases.create'))) AND app.inventory_purchase_read(k) AND app.business_office_allowed(t,source."officeId",nullif(current_setting('app.actor_id',true),'')),false) THEN RAISE EXCEPTION 'Inventory receipt posting is not permitted' USING ERRCODE='42501';END IF;
 FOR r IN SELECT i.*,COALESCE(s.quantity,0) posted FROM public."PurchaseOrderItem" i LEFT JOIN public."InventoryReceiptStock" s ON s."itemId"=i.id WHERE i."orderId"=k ORDER BY i."productId",i.id LOOP
  IF r."receivedQty"<>r.posted THEN RAISE EXCEPTION 'Receipt stock must be posted with its source' USING ERRCODE='23514';END IF;
  IF r.quantity>r.posted THEN
   PERFORM app.inventory_move(t,source."officeId",r."productId",r.quantity-r.posted,'PURCHASE_RECEIPT',r."unitCostCents",'Purchase receipt '||source."orderNumber",NULL,r.id,request_id);
   UPDATE public."PurchaseOrderItem" SET "receivedQty"=quantity,"updatedAt"=now() WHERE id=r.id;
  END IF;
  INSERT INTO public."InventoryReceiptStock" VALUES(r.id,t,r.quantity) ON CONFLICT("itemId") DO UPDATE SET quantity=excluded.quantity;
 END LOOP;
END $$;

-- Runtime source identity and financial input guards; maintenance bypass alone
-- may repair historical sources. These never depend on a client delta map.
CREATE FUNCTION app.inventory_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r jsonb;prior jsonb;t text;o text;resource text;permission text;fresh boolean:=false; BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_OP='DELETE' THEN r:=to_jsonb(OLD);ELSE r:=to_jsonb(NEW);END IF;IF TG_OP='UPDATE' THEN prior:=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME='InventoryProduct' THEN t:=r->>'tenantId';resource:='inventoryProducts';
 ELSIF TG_TABLE_NAME='PurchaseOrder' THEN t:=r->>'tenantId';o:=r->>'officeId';resource:='inventoryPurchases';
 ELSE SELECT p."tenantId",p."officeId",p.xmin::text::bigint=mod(txid_current(),4294967296) INTO t,o,fresh FROM public."PurchaseOrder" p WHERE p.id=r->>'orderId';resource:='inventoryPurchases';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 permission:=resource||CASE TG_OP WHEN 'INSERT' THEN '.create' WHEN 'DELETE' THEN '.archive' ELSE '.edit' END;
 IF TG_TABLE_NAME='PurchaseOrderItem' THEN permission:=CASE WHEN fresh AND current_setting('app.inventory_operation',true)='inventoryPurchases.create' AND (TG_OP='INSERT' OR (TG_OP='UPDATE' AND (r-ARRAY['receivedQty','updatedAt'])=(prior-ARRAY['receivedQty','updatedAt']))) THEN 'inventoryPurchases.create' ELSE 'inventoryPurchases.edit' END;END IF;
 IF t IS NULL OR NOT COALESCE(app.inventory_capability(t,permission),false) OR (o IS NOT NULL AND NOT COALESCE(app.business_office_allowed(t,o,nullif(current_setting('app.actor_id',true),'')),false)) THEN RAISE EXCEPTION 'Inventory source access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_OP='UPDATE' AND (r->>'id' IS DISTINCT FROM prior->>'id' OR (TG_TABLE_NAME IN ('InventoryProduct','PurchaseOrder') AND r->>'tenantId' IS DISTINCT FROM prior->>'tenantId') OR (TG_TABLE_NAME='PurchaseOrder' AND (r-ARRAY['updatedAt','status','expectedDate','notes','receivedAt']) IS DISTINCT FROM (prior-ARRAY['updatedAt','status','expectedDate','notes','receivedAt'])) OR (TG_TABLE_NAME='PurchaseOrderItem' AND (r-ARRAY['receivedQty','updatedAt']) IS DISTINCT FROM (prior-ARRAY['receivedQty','updatedAt']))) THEN RAISE EXCEPTION 'Inventory source identity and prices are immutable' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='PurchaseOrderItem' AND TG_OP='INSERT' AND NOT (fresh AND current_setting('app.inventory_operation',true)='inventoryPurchases.create') THEN RAISE EXCEPTION 'Inventory source identity and prices are immutable' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='InventoryProduct' AND TG_OP='UPDATE' AND r->>'status' IS DISTINCT FROM prior->>'status' AND NOT app.inventory_capability(t,'inventoryProducts.archive') THEN RAISE EXCEPTION 'Inventory source access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='InventoryProduct' AND TG_OP='INSERT' AND r->>'status'<>'ACTIVE' AND NOT app.inventory_capability(t,'inventoryProducts.archive') THEN RAISE EXCEPTION 'Inventory source access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='PurchaseOrder' AND TG_OP='INSERT' AND o IS DISTINCT FROM app.inventory_creation_office(t,'inventoryPurchases') THEN RAISE EXCEPTION 'Inventory office access is not permitted' USING ERRCODE='42501';END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='InventoryProduct' AND NOT EXISTS(SELECT 1 FROM public."InventoryCategory" c WHERE c.id=r->>'categoryId' AND c."tenantId"=t) THEN RAISE EXCEPTION 'Inventory stock source is not permitted' USING ERRCODE='23514';END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='PurchaseOrder' AND NOT EXISTS(SELECT 1 FROM public."Supplier" s WHERE s.id=r->>'supplierId' AND s."tenantId"=t) THEN RAISE EXCEPTION 'Inventory stock source is not permitted' USING ERRCODE='23514';END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='PurchaseOrderItem' AND NOT EXISTS(SELECT 1 FROM public."InventoryProduct" p WHERE p.id=r->>'productId' AND p."tenantId"=t) THEN RAISE EXCEPTION 'Inventory stock source is not permitted' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' AND TG_TABLE_NAME IN ('PurchaseOrder','PurchaseOrderItem') THEN RAISE EXCEPTION 'Inventory financial sources cannot be deleted' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' AND TG_TABLE_NAME='InventoryProduct' AND app.inventory_product_referenced(t,r->>'id') THEN RAISE EXCEPTION 'Referenced inventory products must be archived' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE TRIGGER inventory_source BEFORE INSERT OR UPDATE OR DELETE ON "InventoryProduct" FOR EACH ROW EXECUTE FUNCTION app.inventory_source_guard();
CREATE TRIGGER inventory_source BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION app.inventory_source_guard();
CREATE TRIGGER inventory_source BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseOrderItem" FOR EACH ROW EXECUTE FUNCTION app.inventory_source_guard();
CREATE FUNCTION app.inventory_source_proof() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE k text;r jsonb;source public."AppointmentOrder"; BEGIN
 IF current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN NULL;END IF;
 IF TG_OP='DELETE' THEN r:=to_jsonb(OLD);ELSE r:=to_jsonb(NEW);END IF;
 k:=CASE WHEN TG_TABLE_NAME IN ('AppointmentOrder','PurchaseOrder') THEN r->>'id' ELSE r->>'orderId' END;
 IF TG_TABLE_NAME IN ('AppointmentOrder','AppointmentOrderProductLine') THEN
  SELECT * INTO source FROM public."AppointmentOrder" WHERE id=k;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Inventory financial sources cannot be deleted' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM (SELECT "productId",sum(quantity)::integer qty FROM public."AppointmentOrderProductLine" WHERE "orderId"=k GROUP BY "productId") l FULL JOIN (SELECT "productId",quantity,"tenantId","officeId" FROM public."InventoryBookingStock" WHERE "orderId"=k) s USING("productId") WHERE COALESCE(s.quantity,0)<>CASE WHEN source.status IN ('CONFIRMED','COMPLETED') THEN COALESCE(l.qty,0) ELSE 0 END OR (s."productId" IS NOT NULL AND (s."tenantId" IS DISTINCT FROM source."tenantId" OR s."officeId" IS DISTINCT FROM source."officeId"))) THEN RAISE EXCEPTION 'Booking stock must be posted with its source' USING ERRCODE='23514';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public."PurchaseOrderItem" i JOIN public."PurchaseOrder" o ON o.id=i."orderId" LEFT JOIN public."InventoryReceiptStock" s ON s."itemId"=i.id WHERE o.id=k AND (i.quantity<=0 OR i."receivedQty"<0 OR i."receivedQty">i.quantity OR i."receivedQty"<>COALESCE(s.quantity,0) OR (s."itemId" IS NOT NULL AND s."tenantId" IS DISTINCT FROM o."tenantId") OR (o.status='RECEIVED' AND i."receivedQty"<>i.quantity))) THEN RAISE EXCEPTION 'Receipt stock must be posted with its source' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
DO $$ DECLARE tbl text;BEGIN FOREACH tbl IN ARRAY ARRAY['AppointmentOrder','AppointmentOrderProductLine','PurchaseOrder','PurchaseOrderItem'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER inventory_source_proof AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.inventory_source_proof()',tbl);END LOOP;END $$;
CREATE FUNCTION app.inventory_next_purchase_number(t text) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE prefix text:='PO-'||to_char(timezone('UTC',now()),'YYYYMMDD')||'-';next_value bigint;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workforce-schedules:'||t,0));
 IF NOT COALESCE(app.inventory_capability(t,'inventoryPurchases.create'),false) THEN RAISE EXCEPTION 'Inventory source access is not permitted' USING ERRCODE='42501';END IF;
 SELECT COALESCE(max(substring("orderNumber" FROM length(prefix)+1)::bigint),0)+1 INTO next_value FROM public."PurchaseOrder" WHERE "tenantId"=t AND "orderNumber" LIKE prefix||'%' AND substring("orderNumber" FROM length(prefix)+1)~'^[0-9]{1,10}$';
 RETURN prefix||lpad(next_value::text,greatest(4,length(next_value::text)),'0');
END $$;
CREATE FUNCTION app.inventory_product_referenced(t text,p text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN IF NOT COALESCE(app.inventory_capability(t,'inventoryProducts.archive'),false) OR NOT EXISTS(SELECT 1 FROM public."InventoryProduct" WHERE "tenantId"=t AND id=p) THEN RAISE EXCEPTION 'Inventory source access is not permitted' USING ERRCODE='42501';END IF;
 RETURN EXISTS(SELECT 1 FROM public."InventoryStockMovement" WHERE "tenantId"=t AND "productId"=p) OR EXISTS(SELECT 1 FROM public."PurchaseOrderItem" i JOIN public."PurchaseOrder" o ON o.id=i."orderId" WHERE o."tenantId"=t AND i."productId"=p) OR EXISTS(SELECT 1 FROM public."AppointmentOrderProductLine" l JOIN public."AppointmentOrder" o ON o.id=l."orderId" WHERE o."tenantId"=t AND l."productId"=p) OR EXISTS(SELECT 1 FROM public."InventoryOfficeStock" WHERE "tenantId"=t AND "productId"=p AND "onHandQty"<>0);
END $$;
COMMIT;
