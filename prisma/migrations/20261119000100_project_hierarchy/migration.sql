BEGIN;
LOCK TABLE "RealEstateProject" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "RealEstateProject" ADD COLUMN "rootId" text DEFAULT ''::text;
CREATE TABLE "RealEstateProjectAncestor" (
 "tenantId" text NOT NULL, "ancestorId" text NOT NULL, "descendantId" text NOT NULL,
 distance integer NOT NULL CHECK(distance >= 0),
 PRIMARY KEY ("tenantId","ancestorId","descendantId"),
 FOREIGN KEY ("tenantId","ancestorId") REFERENCES "RealEstateProject"("tenantId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","descendantId") REFERENCES "RealEstateProject"("tenantId",id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RealEstateProjectAncestor_tenantId_descendantId_distance_idx" ON "RealEstateProjectAncestor"("tenantId","descendantId",distance);

-- Root reachability also proves that every existing record has an acyclic tree.
WITH RECURSIVE tree AS (
 SELECT "tenantId",id,id root FROM "RealEstateProject" WHERE "parentId" IS NULL
 UNION ALL
 SELECT p."tenantId",p.id,t.root FROM "RealEstateProject" p JOIN tree t ON p."tenantId"=t."tenantId" AND p."parentId"=t.id
) UPDATE "RealEstateProject" p SET "rootId"=t.root FROM tree t WHERE p."tenantId"=t."tenantId" AND p.id=t.id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "RealEstateProject" WHERE "rootId"='') THEN RAISE EXCEPTION 'Project hierarchy contains an unreachable or circular parent'; END IF;
END $$;
WITH RECURSIVE paths AS (
 SELECT "tenantId",id ancestor,id descendant,0 distance FROM "RealEstateProject"
 UNION ALL
 SELECT p."tenantId",a.ancestor,p.id,a.distance+1 FROM "RealEstateProject" p JOIN paths a ON p."tenantId"=a."tenantId" AND p."parentId"=a.descendant
) INSERT INTO "RealEstateProjectAncestor" SELECT "tenantId",ancestor,descendant,distance FROM paths;

ALTER TABLE "RealEstateProject" ALTER COLUMN "rootId" SET NOT NULL;
CREATE UNIQUE INDEX "RealEstateProject_tenantId_rootId_id_key" ON "RealEstateProject"("tenantId","rootId",id);
CREATE INDEX "RealEstateProject_tenantId_rootId_idx" ON "RealEstateProject"("tenantId","rootId");
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_rootId_fkey" FOREIGN KEY ("tenantId","rootId") REFERENCES "RealEstateProject"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RealEstateEnquiryContext" DROP CONSTRAINT "RealEstateEnquiryContext_tenantId_projectId_subprojectId_fkey";
ALTER TABLE "RealEstateOpportunityContext" DROP CONSTRAINT "RealEstateOpportunityContext_tenantId_projectId_subproject_fkey";
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_projectId_subprojectId_fkey" FOREIGN KEY ("tenantId","projectId","subprojectId") REFERENCES "RealEstateProject"("tenantId","rootId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_projectId_subproject_fkey" FOREIGN KEY ("tenantId","projectId","subprojectId") REFERENCES "RealEstateProject"("tenantId","rootId",id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION app.project_hierarchy_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE parent_root text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."tenantId",NEW."parentId",NEW."rootId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."parentId",OLD."rootId") THEN
   RAISE EXCEPTION 'Project identity and parent are immutable; hierarchy moves require a reviewed reassignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW."parentId" IS NULL THEN NEW."rootId":=NEW.id;
 ELSE
  SELECT "rootId" INTO parent_root FROM public."RealEstateProject" WHERE "tenantId"=NEW."tenantId" AND id=NEW."parentId" FOR KEY SHARE;
  IF parent_root IS NULL OR NEW."parentId"=NEW.id THEN RAISE EXCEPTION 'Choose a parent in this business' USING ERRCODE='23514'; END IF;
  NEW."rootId":=parent_root;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.project_hierarchy_identity() FROM PUBLIC;
CREATE TRIGGER project_hierarchy_identity BEFORE INSERT OR UPDATE ON "RealEstateProject" FOR EACH ROW EXECUTE FUNCTION app.project_hierarchy_identity();

CREATE FUNCTION app.project_hierarchy_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
BEGIN
 INSERT INTO public."RealEstateProjectAncestor" VALUES(NEW."tenantId",NEW.id,NEW.id,0);
 IF NEW."parentId" IS NOT NULL THEN
  INSERT INTO public."RealEstateProjectAncestor" SELECT NEW."tenantId","ancestorId",NEW.id,distance+1 FROM public."RealEstateProjectAncestor" WHERE "tenantId"=NEW."tenantId" AND "descendantId"=NEW."parentId";
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.project_hierarchy_links() FROM PUBLIC;
CREATE TRIGGER project_hierarchy_links AFTER INSERT ON "RealEstateProject" FOR EACH ROW EXECUTE FUNCTION app.project_hierarchy_links();

-- Lineage is private, read-only metadata. Normal project scope still applies at
-- every consumer; this projection cannot grant an action or a record assignment.
ALTER TABLE "RealEstateProjectAncestor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateProjectAncestor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateProjectAncestor" FOR SELECT USING(app.tenant_match("tenantId"));
CREATE POLICY project_office ON "RealEstateProjectAncestor" AS RESTRICTIVE FOR SELECT USING(app.record_office_allowed("tenantId",'projects',"descendantId",COALESCE(current_setting('app.actor_id',true),'')));
CREATE POLICY project_sharing ON "RealEstateProjectAncestor" AS RESTRICTIVE FOR SELECT USING(app.record_sharing_allowed("tenantId",'projects',"descendantId",COALESCE(current_setting('app.actor_id',true),''),'READ'));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON "RealEstateProjectAncestor" FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='RealEstateProject' AND privilege_type='SELECT' AND grantee<>'PUBLIC' LOOP
  EXECUTE format('GRANT SELECT ON "RealEstateProjectAncestor" TO %I',r.grantee);
  -- New tables may inherit default write grants. Derivation is trigger-only.
  EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON "RealEstateProjectAncestor" FROM %I',r.grantee);
 END LOOP;
END $$;
COMMIT;
