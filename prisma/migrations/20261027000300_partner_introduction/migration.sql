BEGIN;
ALTER TABLE "CrmEnquiry" ADD COLUMN "introducedByCollaboratorId" text, ADD COLUMN "partnerAttribution" jsonb;
ALTER TABLE "CrmOpportunity" ADD COLUMN "introducedByCollaboratorId" text, ADD COLUMN "partnerAttribution" jsonb;
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_introducedByCollaboratorId_fkey" FOREIGN KEY ("tenantId","introducedByCollaboratorId") REFERENCES "ExternalCollaborator"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_introducedByCollaboratorId_fkey" FOREIGN KEY ("tenantId","introducedByCollaboratorId") REFERENCES "ExternalCollaborator"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "CrmEnquiry_tenantId_introducedByCollaboratorId_idx" ON "CrmEnquiry"("tenantId","introducedByCollaboratorId");
CREATE INDEX "CrmOpportunity_tenantId_introducedByCollaboratorId_idx" ON "CrmOpportunity"("tenantId","introducedByCollaboratorId");

-- Invoker visibility is deliberate: copying attribution must not disclose a
-- hidden enquiry through a SECURITY DEFINER source lookup. No source/grant backfill.
CREATE FUNCTION app.guard_introduction_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE source_id text; source_partner text; source_evidence jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."introducedByCollaboratorId" IS DISTINCT FROM OLD."introducedByCollaboratorId" OR NEW."partnerAttribution" IS DISTINCT FROM OLD."partnerAttribution"
    OR (TG_TABLE_NAME='CrmOpportunity' AND to_jsonb(NEW)->>'enquiryId' IS DISTINCT FROM to_jsonb(OLD)->>'enquiryId') THEN
   RAISE EXCEPTION 'Introduction identity and evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 source_id:=CASE WHEN TG_TABLE_NAME='CrmOpportunity' THEN to_jsonb(NEW)->>'enquiryId' END;
 IF source_id IS NOT NULL THEN
  SELECT "introducedByCollaboratorId","partnerAttribution" INTO source_partner,source_evidence FROM public."CrmEnquiry" WHERE "tenantId"=NEW."tenantId" AND id=source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Introduction source is not permitted' USING ERRCODE='42501'; END IF;
  IF (NEW."introducedByCollaboratorId" IS NOT NULL AND NEW."introducedByCollaboratorId" IS DISTINCT FROM source_partner)
    OR (NEW."partnerAttribution" IS NOT NULL AND NEW."partnerAttribution" IS DISTINCT FROM source_evidence) THEN
   RAISE EXCEPTION 'Introduction evidence must come from its source' USING ERRCODE='23514';
  END IF;
  NEW."introducedByCollaboratorId":=source_partner; NEW."partnerAttribution":=source_evidence;
 ELSIF NEW."partnerAttribution" IS NOT NULL THEN
  RAISE EXCEPTION 'Introduction evidence must come from its source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_introduction_source() FROM PUBLIC;

-- Private directory lookup only for an already authorized source INSERT.
-- Trigger functions are not general-purpose directory/search capabilities.
CREATE FUNCTION app.capture_partner_introduction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE actor_id text:=nullif(current_setting('app.actor_id',true),''); actor_role text; actor_partner text; partner public."ExternalCollaborator"%ROWTYPE; maintenance boolean;
BEGIN
 IF TG_TABLE_NAME='CrmOpportunity' AND to_jsonb(NEW)->>'enquiryId' IS NOT NULL THEN RETURN NEW; END IF;
 SELECT role::text,"collaboratorId" INTO actor_role,actor_partner FROM public."User" u WHERE u.id=actor_id AND u."tenantId"=NEW."tenantId" AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM public."Tenant" t WHERE t.id=u."tenantId" AND t.status='ACTIVE');
 IF NEW."introducedByCollaboratorId" IS NULL AND actor_partner IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public."Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 -- Security administration uses this same lock. Refresh after any wait.
 SELECT role::text,"collaboratorId" INTO actor_role,actor_partner FROM public."User" u WHERE u.id=actor_id AND u."tenantId"=NEW."tenantId" AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM public."Tenant" t WHERE t.id=u."tenantId" AND t.status='ACTIVE') FOR SHARE;
 maintenance:=current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls));
 IF NOT maintenance AND (NEW."tenantId" IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR actor_role IS NULL OR actor_role NOT IN ('ADMIN','MANAGER','STAFF') OR (actor_partner IS NULL AND actor_role<>'ADMIN') OR (actor_partner IS NOT NULL AND NEW."introducedByCollaboratorId" IS NOT NULL AND NEW."introducedByCollaboratorId"<>actor_partner)) THEN
  RAISE EXCEPTION 'Introducing collaborator selection is not permitted' USING ERRCODE='42501';
 END IF;
 NEW."introducedByCollaboratorId":=COALESCE(actor_partner,NEW."introducedByCollaboratorId");
 SELECT * INTO partner FROM public."ExternalCollaborator" WHERE "tenantId"=NEW."tenantId" AND id=NEW."introducedByCollaboratorId" AND NOT archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active introducing collaborator in this workspace' USING ERRCODE='23514'; END IF;
 NEW."partnerAttribution":=jsonb_build_object('version',1,'code',partner.code,'name',partner.name,'supervisorUserId',partner."supervisorUserId");
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.capture_partner_introduction() FROM PUBLIC;
CREATE TRIGGER introduction_source BEFORE INSERT OR UPDATE ON "CrmEnquiry" FOR EACH ROW EXECUTE FUNCTION app.guard_introduction_source();
CREATE TRIGGER introduction_source BEFORE INSERT OR UPDATE ON "CrmOpportunity" FOR EACH ROW EXECUTE FUNCTION app.guard_introduction_source();
CREATE TRIGGER partner_introduction BEFORE INSERT ON "CrmEnquiry" FOR EACH ROW EXECUTE FUNCTION app.capture_partner_introduction();
CREATE TRIGGER partner_introduction BEFORE INSERT ON "CrmOpportunity" FOR EACH ROW EXECUTE FUNCTION app.capture_partner_introduction();
COMMIT;
