BEGIN;
CREATE TABLE "RealEstateLaunchPhase" (
 "tenantId" text NOT NULL, id text NOT NULL, "projectId" text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','OPEN','PAUSED','CLOSED')),
 "opensAt" timestamp(3), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL,
 PRIMARY KEY("tenantId",id),
 FOREIGN KEY("tenantId","projectId") REFERENCES "RealEstateProject"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RealEstateLaunchPhase_tenantId_projectId_code_key" ON "RealEstateLaunchPhase"("tenantId","projectId",code);
CREATE INDEX "RealEstateLaunchPhase_tenantId_projectId_name_id_idx" ON "RealEstateLaunchPhase"("tenantId","projectId",name,id);
ALTER TABLE "RealEstateUnit" ADD COLUMN "launchPhaseId" text;
ALTER TABLE "RealEstateUnit" ADD CONSTRAINT "RealEstateUnit_tenantId_launchPhaseId_fkey" FOREIGN KEY("tenantId","launchPhaseId") REFERENCES "RealEstateLaunchPhase"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RealEstateUnit_tenantId_launchPhaseId_idx" ON "RealEstateUnit"("tenantId","launchPhaseId");

ALTER TABLE "RealEstateLaunchPhase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateLaunchPhase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateLaunchPhase" FOR ALL USING(app.tenant_match("tenantId")) WITH CHECK(app.tenant_match("tenantId"));
CREATE POLICY phase_office ON "RealEstateLaunchPhase" AS RESTRICTIVE FOR ALL USING(app.record_office_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''))) WITH CHECK(app.record_office_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),'')));
CREATE POLICY phase_read ON "RealEstateLaunchPhase" AS RESTRICTIVE FOR SELECT USING(app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
CREATE POLICY phase_insert ON "RealEstateLaunchPhase" AS RESTRICTIVE FOR INSERT WITH CHECK(app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));
CREATE POLICY phase_update ON "RealEstateLaunchPhase" AS RESTRICTIVE FOR UPDATE USING(app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT')) WITH CHECK(app.record_sharing_allowed("tenantId",'projects',"projectId",COALESCE(current_setting('app.actor_id',true),''),'EDIT'));

CREATE FUNCTION app.launch_phase_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Launch phases must be retained; close the phase instead' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW."tenantId",NEW.id,NEW."projectId",NEW."createdAt") IS DISTINCT FROM (OLD."tenantId",OLD.id,OLD."projectId",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION 'Phase identity is immutable and updates require a fresh version' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.version<>1 THEN RAISE EXCEPTION 'A new phase starts at version one' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."RealEstateProject" WHERE "tenantId"=NEW."tenantId" AND id=NEW."projectId" AND "parentId" IS NULL AND NOT archived) THEN
  RAISE EXCEPTION 'Choose an active top-level project for the launch phase' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.launch_phase_guard() FROM PUBLIC;
CREATE TRIGGER launch_phase_guard BEFORE INSERT OR UPDATE OR DELETE ON "RealEstateLaunchPhase" FOR EACH ROW EXECUTE FUNCTION app.launch_phase_guard();

CREATE FUNCTION app.unit_launch_phase_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE root_id text; phase_root text;
BEGIN
 -- Lock the same catalog row as reservations before inspecting active holds.
 PERFORM id FROM public."CatalogItem" WHERE "tenantId"=NEW."tenantId" AND id=NEW."itemId" FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW."launchPhaseId",NEW."projectId") IS DISTINCT FROM (OLD."launchPhaseId",OLD."projectId") AND EXISTS(
  SELECT 1 FROM public."UnitReservation" WHERE "tenantId"=OLD."tenantId" AND "itemId"=OLD."itemId" AND (status='ALLOCATED' OR (status='HELD' AND "expiresAt">clock_timestamp()))
 ) THEN RAISE EXCEPTION 'Release the active reservation before changing this unit phase or project' USING ERRCODE='23514'; END IF;
 IF NEW."launchPhaseId" IS NOT NULL THEN
  SELECT "rootId" INTO root_id FROM public."RealEstateProject" WHERE "tenantId"=NEW."tenantId" AND id=NEW."projectId";
  SELECT "projectId" INTO phase_root FROM public."RealEstateLaunchPhase" WHERE "tenantId"=NEW."tenantId" AND id=NEW."launchPhaseId" FOR SHARE;
  IF root_id IS NULL OR phase_root IS DISTINCT FROM root_id THEN RAISE EXCEPTION 'The launch phase must belong to this unit project' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.unit_launch_phase_guard() FROM PUBLIC;
CREATE TRIGGER unit_launch_phase_guard BEFORE INSERT OR UPDATE ON "RealEstateUnit" FOR EACH ROW EXECUTE FUNCTION app.unit_launch_phase_guard();

CREATE FUNCTION app.reservation_launch_phase_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE phase_id text; phase_status text; opens_at timestamp;
BEGIN
 PERFORM id FROM public."CatalogItem" WHERE "tenantId"=NEW."tenantId" AND id=NEW."itemId" FOR UPDATE;
 SELECT "launchPhaseId" INTO phase_id FROM public."RealEstateUnit" WHERE "tenantId"=NEW."tenantId" AND "itemId"=NEW."itemId";
 IF phase_id IS NOT NULL THEN
  SELECT status,"opensAt" INTO phase_status,opens_at FROM public."RealEstateLaunchPhase" WHERE "tenantId"=NEW."tenantId" AND id=phase_id FOR SHARE;
  IF phase_status IS DISTINCT FROM 'OPEN' OR opens_at>(clock_timestamp() AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'Launch phase is not open for new reservations' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.reservation_launch_phase_guard() FROM PUBLIC;
-- Existing holds can still be allocated/released; only new holds are gated.
CREATE TRIGGER reservation_launch_phase_guard BEFORE INSERT ON "UnitReservation" FOR EACH ROW EXECUTE FUNCTION app.reservation_launch_phase_guard();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='RealEstateProject' AND privilege_type IN ('SELECT','INSERT','UPDATE') AND grantee<>'PUBLIC' LOOP
  EXECUTE format('GRANT %s ON "RealEstateLaunchPhase" TO %I',r.privilege_type,r.grantee);
  EXECUTE format('REVOKE DELETE,TRUNCATE ON "RealEstateLaunchPhase" FROM %I',r.grantee);
 END LOOP;
END $$;
-- Existing unit phase stays NULL. No availability, ownership or sales fact changes.
COMMIT;
