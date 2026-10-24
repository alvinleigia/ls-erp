-- Shared record access. Existing records remain Normal; no owners or memberships change.
BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Record sharing policy functions require a migration owner with BYPASSRLS'; END IF; END $$;
-- AlterTable
ALTER TABLE "CrmOpportunity" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "CrmAccount" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "CrmEnquiry" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "CrmTask" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "RealEstateProject" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "CrmQuotation" ADD COLUMN     "sharingPolicyId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "sharingPolicyId" TEXT;

-- CreateTable
CREATE TABLE "RecordSharingPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordSharingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogReservationAvailability" (
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogReservationAvailability_pkey" PRIMARY KEY ("tenantId","itemId")
);

-- CreateTable
CREATE TABLE "RecordSharingGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "level" TEXT NOT NULL,

    CONSTRAINT "RecordSharingGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordSharingPolicy_tenantId_restricted_resource_idx" ON "RecordSharingPolicy"("tenantId", "restricted", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "RecordSharingPolicy_tenantId_id_key" ON "RecordSharingPolicy"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecordSharingPolicy_tenantId_resource_recordId_key" ON "RecordSharingPolicy"("tenantId", "resource", "recordId");

-- CreateIndex
CREATE INDEX "RecordSharingGrant_tenantId_userId_policyId_idx" ON "RecordSharingGrant"("tenantId", "userId", "policyId");

-- CreateIndex
CREATE INDEX "RecordSharingGrant_tenantId_teamId_policyId_idx" ON "RecordSharingGrant"("tenantId", "teamId", "policyId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordSharingGrant_policyId_userId_key" ON "RecordSharingGrant"("policyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordSharingGrant_policyId_teamId_key" ON "RecordSharingGrant"("policyId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOpportunity_tenantId_sharingPolicyId_key" ON "CrmOpportunity"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenantId_sharingPolicyId_key" ON "CrmContact"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAccount_tenantId_sharingPolicyId_key" ON "CrmAccount"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEnquiry_tenantId_sharingPolicyId_key" ON "CrmEnquiry"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTask_tenantId_sharingPolicyId_key" ON "CrmTask"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateProject_tenantId_sharingPolicyId_key" ON "RealEstateProject"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmQuotation_tenantId_sharingPolicyId_key" ON "CrmQuotation"("tenantId", "sharingPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_sharingPolicyId_key" ON "SalesOrder"("tenantId", "sharingPolicyId");

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotation" ADD CONSTRAINT "CrmQuotation_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_sharingPolicyId_fkey" FOREIGN KEY ("tenantId", "sharingPolicyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSharingPolicy" ADD CONSTRAINT "RecordSharingPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReservationAvailability" ADD CONSTRAINT "CatalogReservationAvailability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReservationAvailability" ADD CONSTRAINT "CatalogReservationAvailability_tenantId_itemId_fkey" FOREIGN KEY ("tenantId", "itemId") REFERENCES "CatalogItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSharingGrant" ADD CONSTRAINT "RecordSharingGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSharingGrant" ADD CONSTRAINT "RecordSharingGrant_tenantId_policyId_fkey" FOREIGN KEY ("tenantId", "policyId") REFERENCES "RecordSharingPolicy"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSharingGrant" ADD CONSTRAINT "RecordSharingGrant_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordSharingGrant" ADD CONSTRAINT "RecordSharingGrant_tenantId_teamId_fkey" FOREIGN KEY ("tenantId", "teamId") REFERENCES "BusinessTeam"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "RecordSharingPolicy" ADD CONSTRAINT "RecordSharingPolicy_resource_check" CHECK(resource IN ('contacts','accounts','enquiries','opportunities','activities','projects','quotations','salesOrders')), ADD CONSTRAINT "RecordSharingPolicy_version_check" CHECK(version>0);
ALTER TABLE "RecordSharingGrant" ADD CONSTRAINT "RecordSharingGrant_subject_check" CHECK(("userId" IS NOT NULL)::int+("teamId" IS NOT NULL)::int=1), ADD CONSTRAINT "RecordSharingGrant_level_check" CHECK(level IN ('READ','EDIT'));
ALTER TABLE "RecordSharingPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecordSharingPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecordSharingPolicy" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RecordSharingGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecordSharingGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecordSharingGrant" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));

CREATE FUNCTION app.record_sharing_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW."sharingPolicyId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."RecordSharingPolicy" p WHERE p.id=NEW."sharingPolicyId" AND p."tenantId"=NEW."tenantId" AND p.resource=TG_ARGV[0] AND p."recordId"=NEW.id) THEN RAISE EXCEPTION 'Sharing policy does not belong to this record' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "CrmContact" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('contacts');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "CrmAccount" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('accounts');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "CrmEnquiry" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('enquiries');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "CrmOpportunity" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('opportunities');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "CrmTask" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('activities');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "RealEstateProject" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('projects');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "CrmQuotation" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('quotations');
CREATE TRIGGER record_sharing_identity BEFORE INSERT OR UPDATE OF "sharingPolicyId","tenantId",id ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION app.record_sharing_identity('salesOrders');
-- The owner can only answer visibility questions, never return source data. The
-- app schema is not a public API schema. Inputs remain tenant-bound by outer RLS.
CREATE FUNCTION app.record_sharing_allowed(t text,r text,k text,u text,l text DEFAULT 'READ') RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE p public."RecordSharingPolicy"%ROWTYPE; own boolean:=false; parent text; linked text; uid text; row_role text;
BEGIN
 IF current_setting('app.rls_bypass',true)='on' THEN RETURN true; END IF;
 IF k IS NULL OR k='' THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."RecordSharingPolicy" WHERE "tenantId"=t) THEN RETURN true; END IF;
 SELECT role::text INTO row_role FROM public."User" WHERE "tenantId"=t AND id=u AND status='ACTIVE';
 IF row_role='ADMIN' THEN RETURN true; END IF;
 IF r='projects' THEN
   SELECT "parentId" INTO parent FROM public."RealEstateProject" WHERE "tenantId"=t AND id=k;
   IF parent IS NOT NULL THEN RETURN app.record_sharing_allowed(t,'projects',parent,u,l); END IF;
 END IF;
 SELECT * INTO p FROM public."RecordSharingPolicy" WHERE "tenantId"=t AND resource=r AND "recordId"=k;
 IF FOUND AND p.restricted THEN
   CASE r
    WHEN 'contacts' THEN SELECT "ownerUserId" INTO uid FROM public."CrmContact" WHERE "tenantId"=t AND id=k;
    WHEN 'accounts' THEN SELECT "ownerUserId" INTO uid FROM public."CrmAccount" WHERE "tenantId"=t AND id=k;
    WHEN 'enquiries' THEN SELECT "assignedUserId" INTO uid FROM public."CrmEnquiry" WHERE "tenantId"=t AND id=k;
    WHEN 'opportunities' THEN SELECT "assignedUserId" INTO uid FROM public."CrmOpportunity" WHERE "tenantId"=t AND id=k;
    WHEN 'activities' THEN SELECT "assignedUserId" INTO uid FROM public."CrmTask" WHERE "tenantId"=t AND id=k;
    WHEN 'quotations' THEN SELECT o."assignedUserId" INTO uid FROM public."CrmQuotation" q JOIN public."CrmOpportunity" o ON o."tenantId"=q."tenantId" AND o.id=q."opportunityId" WHERE q."tenantId"=t AND q.id=k;
    WHEN 'salesOrders' THEN SELECT o."assignedUserId" INTO uid FROM public."SalesOrder" s JOIN public."CrmQuotation" q ON q."tenantId"=s."tenantId" AND q.id=s."quotationId" JOIN public."CrmOpportunity" o ON o."tenantId"=q."tenantId" AND o.id=q."opportunityId" WHERE s."tenantId"=t AND s.id=k;
    WHEN 'projects' THEN SELECT EXISTS(SELECT 1 FROM public."RealEstateProjectMember" WHERE "tenantId"=t AND "projectId"=k AND "userId"=u) INTO own;
    ELSE RETURN false;
   END CASE;
   own:=COALESCE(own,false) OR COALESCE(uid=u,false);
   IF row_role IS NULL OR NOT (own OR EXISTS(SELECT 1 FROM public."RecordSharingGrant" g WHERE g."tenantId"=t AND g."policyId"=p.id AND (l='READ' OR g.level='EDIT') AND (g."userId"=u OR EXISTS(SELECT 1 FROM public."BusinessTeamMember" m JOIN public."BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId" WHERE m."tenantId"=t AND m."userId"=u AND m."teamId"=g."teamId" AND NOT team.archived)))) THEN RETURN false; END IF;
 END IF;
 -- Source restrictions remain in force even when a derived record is shared.
 CASE r
  WHEN 'enquiries' THEN
   SELECT "contactId","accountId" INTO parent,linked FROM public."CrmEnquiry" WHERE "tenantId"=t AND id=k;
   IF NOT app.record_sharing_allowed(t,'contacts',parent,u,'READ') OR NOT app.record_sharing_allowed(t,'accounts',linked,u,'READ') THEN RETURN false; END IF;
   SELECT "projectId" INTO parent FROM public."RealEstateEnquiryContext" WHERE "tenantId"=t AND "enquiryId"=k;
   RETURN app.record_sharing_allowed(t,'projects',parent,u,'READ');
  WHEN 'opportunities' THEN
   SELECT "contactId","accountId","enquiryId" INTO parent,linked,uid FROM public."CrmOpportunity" WHERE "tenantId"=t AND id=k;
   IF NOT app.record_sharing_allowed(t,'contacts',parent,u,'READ') OR NOT app.record_sharing_allowed(t,'accounts',linked,u,'READ') OR NOT app.record_sharing_allowed(t,'enquiries',uid,u,'READ') THEN RETURN false; END IF;
   SELECT "projectId" INTO parent FROM public."RealEstateOpportunityContext" WHERE "tenantId"=t AND "opportunityId"=k;
   RETURN app.record_sharing_allowed(t,'projects',parent,u,'READ');
  WHEN 'activities' THEN
   SELECT "contactId","enquiryId","opportunityId","collectionOrderId" INTO parent,linked,uid,k FROM public."CrmTask" WHERE "tenantId"=t AND id=k;
   RETURN app.record_sharing_allowed(t,'contacts',parent,u,'READ') AND app.record_sharing_allowed(t,'enquiries',linked,u,'READ') AND app.record_sharing_allowed(t,'opportunities',uid,u,'READ') AND app.record_sharing_allowed(t,'salesOrders',k,u,'READ');
  WHEN 'quotations' THEN
   SELECT "opportunityId" INTO parent FROM public."CrmQuotation" WHERE "tenantId"=t AND id=k;
   RETURN app.record_sharing_allowed(t,'opportunities',parent,u,'READ');
  WHEN 'salesOrders' THEN
   SELECT "quotationId" INTO parent FROM public."SalesOrder" WHERE "tenantId"=t AND id=k;
   RETURN app.record_sharing_allowed(t,'quotations',parent,u,'READ');
  WHEN 'catalogItems' THEN
   SELECT "projectId" INTO parent FROM public."RealEstateUnit" WHERE "tenantId"=t AND "itemId"=k;
   RETURN app.record_sharing_allowed(t,'projects',parent,u,'READ');
  WHEN 'unitReservations' THEN
   SELECT "orderId","itemId" INTO parent,linked FROM public."UnitReservation" WHERE "tenantId"=t AND id=k;
   RETURN app.record_sharing_allowed(t,'salesOrders',parent,u,l) AND app.record_sharing_allowed(t,'catalogItems',linked,u,'READ');
  WHEN 'unitReservationEvent' THEN RETURN app.record_sharing_allowed(t,'unitReservations',k,u,l);
  ELSE RETURN true;
 END CASE;
END $$;

CREATE FUNCTION app.record_sharing_handoff_allowed(t text,e text,u text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public."CrmTask" w WHERE w."tenantId"=t AND w."enquiryId"=e AND w."followParentAssignment" AND w.status IN ('OPEN','IN_PROGRESS') AND NOT app.record_sharing_allowed(t,'activities',w.id,u,'EDIT'))
$$;

CREATE FUNCTION app.record_sharing_audit_allowed(t text,entity text,k text,b jsonb,a jsonb,u text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE r text; pair record; doc jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."RecordSharingPolicy" WHERE "tenantId"=t) THEN RETURN true; END IF;
 r:=CASE entity WHEN 'CrmContact' THEN 'contacts' WHEN 'CrmAccount' THEN 'accounts' WHEN 'CrmEnquiry' THEN 'enquiries' WHEN 'CrmOpportunity' THEN 'opportunities' WHEN 'CrmTask' THEN 'activities' WHEN 'RealEstateProject' THEN 'projects' WHEN 'CrmQuotation' THEN 'quotations' WHEN 'SalesOrder' THEN 'salesOrders' WHEN 'OrderReceivable' THEN 'salesOrders' WHEN 'UnitReservation' THEN 'unitReservations' WHEN 'CatalogItem' THEN 'catalogItems' END;
 IF r IS NOT NULL AND NOT app.record_sharing_allowed(t,r,k,u,'READ') THEN RETURN false; END IF;
 FOREACH doc IN ARRAY ARRAY[b,a] LOOP
  IF jsonb_typeof(doc)='object' THEN
   FOR pair IN SELECT * FROM (VALUES ('contactId','contacts'),('accountId','accounts'),('developerAccountId','accounts'),('enquiryId','enquiries'),('opportunityId','opportunities'),('projectId','projects'),('quotationId','quotations'),('orderId','salesOrders'),('taskId','activities')) v(key,resource) LOOP
    IF jsonb_typeof(doc->pair.key)='string' AND NOT app.record_sharing_allowed(t,pair.resource,doc->>pair.key,u,'READ') THEN RETURN false; END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN true;
END $$;

-- Reclaim only holds whose database-clock expiry has passed. No private order
-- data is returned. The transition, event and audit remain one transaction.
CREATE FUNCTION app.expire_item_reservations(t text,item text,request text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE u text:=COALESCE(current_setting('app.actor_id',true),''); who public."User"%ROWTYPE; expired record;
BEGIN
 IF NOT app.tenant_match(t) THEN RAISE EXCEPTION 'Tenant context required' USING ERRCODE='42501'; END IF;
 SELECT * INTO who FROM public."User" WHERE "tenantId"=t AND id=u AND status='ACTIVE' AND role IN ('ADMIN','MANAGER','STAFF');
 IF NOT FOUND OR NOT app.record_sharing_allowed(t,'catalogItems',item,u,'READ') THEN RAISE EXCEPTION 'Catalog access required' USING ERRCODE='42501'; END IF;
 PERFORM id FROM public."CatalogItem" WHERE "tenantId"=t AND id=item FOR UPDATE;
 FOR expired IN UPDATE public."UnitReservation" SET status='EXPIRED',version=version+1,"updatedAt"=clock_timestamp() WHERE "tenantId"=t AND "itemId"=item AND status='HELD' AND "expiresAt"<=clock_timestamp() RETURNING id,version LOOP
  INSERT INTO public."UnitReservationEvent"("tenantId","reservationId",version,status,"actorId","actorName",reason) VALUES(t,expired.id,expired.version,'EXPIRED',u,COALESCE(who.name,who.email,'User'),'Hold expired at its scheduled expiry.');
  INSERT INTO public."AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId",before,after)
   VALUES(gen_random_uuid()::text,t,'catalog.reservation.expired','UnitReservation',expired.id,u,who.role,request,jsonb_build_object('status','HELD'),jsonb_build_object('status','EXPIRED','version',expired.version,'reason','Hold expired at its scheduled expiry.'));
 END LOOP;
END $$;

-- A minimal availability projection allows filtering/counting before pagination
-- without granting access to reservations, orders or customer details.
ALTER TABLE "CatalogReservationAvailability" ADD CONSTRAINT "CatalogReservationAvailability_status_check" CHECK(status IN ('HELD','ALLOCATED'));
ALTER TABLE "CatalogReservationAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogReservationAvailability" FORCE ROW LEVEL SECURITY;
CREATE POLICY availability_read ON "CatalogReservationAvailability" FOR SELECT USING(app.tenant_match("tenantId") AND app.record_sharing_allowed("tenantId",'catalogItems',"itemId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY availability_maintenance ON "CatalogReservationAvailability" USING(app.rls_bypass()) WITH CHECK(app.rls_bypass());
INSERT INTO "CatalogReservationAvailability"("tenantId","itemId",status,"expiresAt") SELECT "tenantId","itemId",status,"expiresAt" FROM "UnitReservation" WHERE status IN ('HELD','ALLOCATED');
CREATE FUNCTION app.sync_catalog_reservation_availability() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.status IN ('HELD','ALLOCATED') THEN DELETE FROM public."CatalogReservationAvailability" WHERE "tenantId"=OLD."tenantId" AND "itemId"=OLD."itemId"; END IF;
  RETURN OLD;
 ELSIF NEW.status IN ('HELD','ALLOCATED') THEN
  INSERT INTO public."CatalogReservationAvailability"("tenantId","itemId",status,"expiresAt") VALUES(NEW."tenantId",NEW."itemId",NEW.status,NEW."expiresAt") ON CONFLICT("tenantId","itemId") DO UPDATE SET status=EXCLUDED.status,"expiresAt"=EXCLUDED."expiresAt";
 ELSIF OLD.status IN ('HELD','ALLOCATED') THEN DELETE FROM public."CatalogReservationAvailability" WHERE "tenantId"=OLD."tenantId" AND "itemId"=OLD."itemId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_catalog_reservation_availability AFTER INSERT OR UPDATE OR DELETE ON "UnitReservation" FOR EACH ROW EXECUTE FUNCTION app.sync_catalog_reservation_availability();

-- Sharing is security metadata, not an amendment to the frozen sales agreement.
DO $sharing$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('app.preserve_sales_order()'::regprocedure) INTO definition;
 definition:=regexp_replace(definition,'BEGIN','BEGIN'||chr(10)||$guard$ IF TG_OP='UPDATE' AND (to_jsonb(OLD)-ARRAY['sharingPolicyId','updatedAt'])=(to_jsonb(NEW)-ARRAY['sharingPolicyId','updatedAt']) THEN RETURN NEW; END IF;$guard$);
 EXECUTE definition;
END $sharing$;
CREATE POLICY record_sharing_read ON "CrmContact" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'contacts',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmContact" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'contacts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'contacts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "CrmContact" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'contacts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "CrmContact" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'contacts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmAccount" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'accounts',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmAccount" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'accounts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'accounts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "CrmAccount" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'accounts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "CrmAccount" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'accounts',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmEnquiry" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'enquiries',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmEnquiry" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'enquiries',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'enquiries',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'accounts',"accountId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "CrmEnquiry" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'enquiries',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'accounts',"accountId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_delete ON "CrmEnquiry" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'enquiries',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmOpportunity" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'opportunities',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmOpportunity" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'opportunities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'opportunities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'accounts',"accountId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "CrmOpportunity" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'opportunities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'accounts',"accountId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_delete ON "CrmOpportunity" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'opportunities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmTask" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'activities',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmTask" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'activities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'activities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'salesOrders',"collectionOrderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "CrmTask" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'activities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'salesOrders',"collectionOrderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_delete ON "CrmTask" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'activities',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "RealEstateProject" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'projects',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "RealEstateProject" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'projects',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "RealEstateProject" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "RealEstateProject" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'projects',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmQuotation" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'quotations',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmQuotation" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'quotations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'quotations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "CrmQuotation" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'quotations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_delete ON "CrmQuotation" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'quotations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "SalesOrder" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "SalesOrder" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "SalesOrder" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT') AND app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_delete ON "SalesOrder" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmQuotationRevision" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmQuotationRevision" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'READ')) WITH CHECK (app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_insert ON "CrmQuotationRevision" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "CrmQuotationRevision" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'quotations',"quotationId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "SalesOrderEvent" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "SalesOrderEvent" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "SalesOrderEvent" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "SalesOrderEvent" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "OrderReceivable" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "OrderReceivable" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "OrderReceivable" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "OrderReceivable" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "OrderReceivableLine" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "OrderReceivableLine" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "OrderReceivableLine" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "OrderReceivableLine" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "OrderReceipt" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "OrderReceipt" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "OrderReceipt" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "OrderReceipt" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "OrderReceiptAllocation" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "OrderReceiptAllocation" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "OrderReceiptAllocation" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "OrderReceiptAllocation" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "OrderReceiptReversal" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "OrderReceiptReversal" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "OrderReceiptReversal" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "OrderReceiptReversal" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'salesOrders',"orderId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmEnquiryFieldValue" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'enquiries',"recordId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmEnquiryFieldValue" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'enquiries',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'enquiries',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "CrmEnquiryFieldValue" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'enquiries',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "CrmEnquiryFieldValue" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'enquiries',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CrmOpportunityFieldValue" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'opportunities',"recordId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CrmOpportunityFieldValue" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'opportunities',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'opportunities',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "CrmOpportunityFieldValue" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'opportunities',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "CrmOpportunityFieldValue" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'opportunities',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "RealEstateProjectFieldValue" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'projects',"recordId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "RealEstateProjectFieldValue" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'projects',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "RealEstateProjectFieldValue" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "RealEstateProjectFieldValue" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'projects',"recordId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "RealEstateProjectMember" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "RealEstateProjectMember" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "RealEstateProjectMember" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "RealEstateProjectMember" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "RealEstateEnquiryContext" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "RealEstateEnquiryContext" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "RealEstateEnquiryContext" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "RealEstateEnquiryContext" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "RealEstateOpportunityContext" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "RealEstateOpportunityContext" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "RealEstateOpportunityContext" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "RealEstateOpportunityContext" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "RealEstateUnit" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "RealEstateUnit" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "RealEstateUnit" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "RealEstateUnit" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "CatalogItem" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'catalogItems',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "CatalogItem" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'catalogItems',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'catalogItems',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "CatalogItem" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'catalogItems',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "CatalogItem" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'catalogItems',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "UnitReservation" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'unitReservations',"id",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "UnitReservation" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'unitReservations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'unitReservations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "UnitReservation" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'unitReservations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "UnitReservation" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'unitReservations',"id",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_read ON "UnitReservationEvent" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'unitReservationEvent',"reservationId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_update ON "UnitReservationEvent" AS RESTRICTIVE FOR UPDATE USING (app.record_sharing_allowed("tenantId",'unitReservationEvent',"reservationId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK (app.record_sharing_allowed("tenantId",'unitReservationEvent',"reservationId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_insert ON "UnitReservationEvent" AS RESTRICTIVE FOR INSERT WITH CHECK (app.record_sharing_allowed("tenantId",'unitReservationEvent',"reservationId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_delete ON "UnitReservationEvent" AS RESTRICTIVE FOR DELETE USING (app.record_sharing_allowed("tenantId",'unitReservationEvent',"reservationId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY record_sharing_events ON "CrmActivity" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'enquiries',"enquiryId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_events ON "CrmTaskEvent" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'activities',"taskId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_events ON "CrmOpportunityActivity" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_contact_links ON "CrmAccountContact" AS RESTRICTIVE USING (app.record_sharing_allowed("tenantId",'contacts',"contactId",COALESCE(current_setting('app.actor_id',true),''),'READ') AND app.record_sharing_allowed("tenantId",'accounts',"accountId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY record_sharing_plan_launches ON "CrmPlanLaunch" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_audit_allowed("tenantId",'',NULL,NULL,input,COALESCE(current_setting('app.actor_id',true),'')));
CREATE POLICY record_sharing_audit ON "AuditLog" AS RESTRICTIVE FOR SELECT USING (app.record_sharing_audit_allowed("tenantId","entityType","entityId",before,after,COALESCE(current_setting('app.actor_id',true),'')));
COMMIT;
