BEGIN;
-- Existing tenant-bound introducer FKs are the canonical single-primary link.
-- Retain them rather than keeping a second relationship/read path for reports.
CREATE TABLE "CrmPartnerLinkEvent" (
 id text PRIMARY KEY, "tenantId" text NOT NULL, "enquiryId" text, "opportunityId" text,
 "recordVersion" integer NOT NULL, "actorUserId" text, before jsonb, after jsonb,
 reason text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CrmPartnerLinkEvent_owner_check" CHECK (num_nonnulls("enquiryId","opportunityId")=1 AND "recordVersion">0 AND length(btrim(reason)) BETWEEN 1 AND 1000),
 FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","enquiryId") REFERENCES "CrmEnquiry"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","opportunityId") REFERENCES "CrmOpportunity"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","actorUserId") REFERENCES "User"("tenantId",id) ON DELETE NO ACTION ON UPDATE CASCADE,
 UNIQUE ("tenantId",id), UNIQUE ("tenantId","enquiryId","recordVersion"), UNIQUE ("tenantId","opportunityId","recordVersion")
);

-- Resolve fresh explicit capabilities under the security-administration lock.
CREATE FUNCTION app.partner_permission_scope(t text,p text) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT CASE WHEN u.role='ADMIN' THEN 'ALL' ELSE COALESCE(a.rules->>p,'NONE') END
 FROM public."User" u JOIN public."Tenant" tenant ON tenant.id=u."tenantId"
 LEFT JOIN public."TenantUserAccess" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 WHERE t=nullif(current_setting('app.tenant_id',true),'') AND u."tenantId"=t
 AND u.id=nullif(current_setting('app.actor_id',true),'') AND u.status='ACTIVE' AND tenant.status='ACTIVE'
 AND u.role IN ('ADMIN','MANAGER','STAFF') AND u."collaboratorId" IS NULL
 AND p IN ('partnerChoices.read','partnerLinks.read','partnerLinks.create','partnerLinks.edit','enquiries.read','enquiries.edit','opportunities.read','opportunities.edit')
 AND EXISTS(SELECT 1 FROM public."TenantModule" m WHERE m."tenantId"=t AND m.key='crm' AND m.allowed AND m.enabled)
 AND (u.role='ADMIN' OR (
   EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND p=ANY(r.permissions))
   AND EXISTS(SELECT 1 FROM public."TenantRoleAssignment" ra JOIN public."TenantAccessRole" r ON r."tenantId"=ra."tenantId" AND r.id=ra."roleId" AND NOT r.archived WHERE ra."tenantId"=t AND ra."userId"=u.id AND (split_part(p,'.',1)||'.read')=ANY(r.permissions))
   AND COALESCE(a.rules->>(split_part(p,'.',1)||'.read'),'NONE')<>'NONE'))
$$;

CREATE FUNCTION app.partner_choice_allowed(t text,k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM public."ExternalCollaborator" c WHERE c."tenantId"=t AND c.id=k AND NOT c.archived AND CASE app.partner_permission_scope(t,'partnerChoices.read')
 WHEN 'ALL' THEN true WHEN 'OWN' THEN c."supervisorUserId"=nullif(current_setting('app.actor_id',true),'')
 WHEN 'MANAGED_TEAMS' THEN c."supervisorUserId"=nullif(current_setting('app.actor_id',true),'') OR EXISTS(
 SELECT 1 FROM public."BusinessTeamMember" manager JOIN public."BusinessTeamMember" member ON member."tenantId"=manager."tenantId" AND member."teamId"=manager."teamId"
 JOIN public."BusinessTeam" team ON team."tenantId"=manager."tenantId" AND team.id=manager."teamId" AND NOT team.archived
 WHERE manager."tenantId"=t AND manager."userId"=nullif(current_setting('app.actor_id',true),'') AND manager."isManager" AND member."userId"=c."supervisorUserId") ELSE false END)
$$;

CREATE FUNCTION app.partner_choices(t text,q text,take_count integer,skip_count integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
 WITH choices AS (SELECT c.id,c.name,c.code,c.classification FROM public."ExternalCollaborator" c WHERE c."tenantId"=t AND app.partner_choice_allowed(t,c.id) AND (c.name ILIKE '%'||q||'%' OR c.code ILIKE '%'||q||'%'))
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM (SELECT * FROM choices ORDER BY name,id LIMIT greatest(1,least(100,take_count)) OFFSET greatest(0,skip_count)) page),'[]'::jsonb),'total',(SELECT count(*) FROM choices))
$$;

CREATE OR REPLACE FUNCTION app.guard_introduction_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE source_id text; source_partner text; source_evidence jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='CrmOpportunity' AND to_jsonb(NEW)->>'enquiryId' IS DISTINCT FROM to_jsonb(OLD)->>'enquiryId' THEN
   RAISE EXCEPTION 'Introduction identity and evidence are immutable: conversion source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 source_id:=CASE WHEN TG_TABLE_NAME='CrmOpportunity' THEN to_jsonb(NEW)->>'enquiryId' END;
 IF source_id IS NOT NULL THEN
  SELECT "introducedByCollaboratorId","partnerAttribution" INTO source_partner,source_evidence FROM public."CrmEnquiry" WHERE "tenantId"=NEW."tenantId" AND id=source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Introduction source is not permitted' USING ERRCODE='42501'; END IF;
  IF (NEW."introducedByCollaboratorId" IS NOT NULL AND NEW."introducedByCollaboratorId" IS DISTINCT FROM source_partner) OR (NEW."partnerAttribution" IS NOT NULL AND NEW."partnerAttribution" IS DISTINCT FROM source_evidence) THEN
   RAISE EXCEPTION 'Introduction evidence must come from its source' USING ERRCODE='23514';
  END IF;
  NEW."introducedByCollaboratorId":=source_partner; NEW."partnerAttribution":=source_evidence;
 ELSIF NEW."partnerAttribution" IS NOT NULL THEN RAISE EXCEPTION 'Introduction evidence must come from its source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.capture_partner_introduction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app SET row_security=off AS $$
DECLARE actor_id text:=nullif(current_setting('app.actor_id',true),''); actor_partner text; partner public."ExternalCollaborator"%ROWTYPE;
 maintenance boolean; permission text; parent_resource text; limit_scope text; explicitly_shared boolean;
BEGIN
 IF TG_OP='UPDATE' AND NEW."introducedByCollaboratorId" IS NOT DISTINCT FROM OLD."introducedByCollaboratorId" THEN
  IF NEW."partnerAttribution" IS DISTINCT FROM OLD."partnerAttribution" THEN RAISE EXCEPTION 'Introduction identity and evidence are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='CrmOpportunity' AND to_jsonb(NEW)->>'enquiryId' IS NOT NULL THEN RETURN NEW; END IF;
 SELECT "collaboratorId" INTO actor_partner FROM public."User" WHERE id=actor_id AND "tenantId"=NEW."tenantId" AND status='ACTIVE';
 IF TG_OP='INSERT' AND NEW."introducedByCollaboratorId" IS NULL AND actor_partner IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public."Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 maintenance:=current_setting('app.rls_bypass',true)='on' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls));
 SELECT "collaboratorId" INTO actor_partner FROM public."User" WHERE id=actor_id AND "tenantId"=NEW."tenantId" AND status='ACTIVE' FOR SHARE;
 IF TG_OP='UPDATE' THEN
  permission:=CASE WHEN OLD."introducedByCollaboratorId" IS NULL THEN 'partnerLinks.create' ELSE 'partnerLinks.edit' END;
  IF NEW.version<>OLD.version+1 OR length(btrim(COALESCE(current_setting('app.partner_change_reason',true),''))) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'Partner changes require a reason and current record version' USING ERRCODE='23514';
  END IF;
  parent_resource:=CASE WHEN TG_TABLE_NAME='CrmEnquiry' THEN 'enquiries' ELSE 'opportunities' END;
  IF NOT maintenance THEN
   SELECT EXISTS(SELECT 1 FROM public."RecordSharingPolicy" sp JOIN public."RecordSharingGrant" sg ON sg."tenantId"=sp."tenantId" AND sg."policyId"=sp.id WHERE sp."tenantId"=NEW."tenantId" AND sp.resource=parent_resource AND sp."recordId"=NEW.id AND sg.level='EDIT' AND (sg."userId"=actor_id OR EXISTS(SELECT 1 FROM public."BusinessTeamMember" m WHERE m."tenantId"=NEW."tenantId" AND m."teamId"=sg."teamId" AND m."userId"=actor_id))) INTO explicitly_shared;
   FOREACH limit_scope IN ARRAY ARRAY[COALESCE(app.partner_permission_scope(NEW."tenantId",parent_resource||'.read'),'NONE'),COALESCE(app.partner_permission_scope(NEW."tenantId",parent_resource||'.edit'),'NONE')] LOOP
    IF limit_scope='NONE' OR (NOT explicitly_shared AND limit_scope<>'ALL' AND OLD."assignedUserId"<>actor_id AND NOT (limit_scope='MANAGED_TEAMS' AND EXISTS(SELECT 1 FROM public."BusinessTeamMember" m JOIN public."BusinessTeam" team ON team."tenantId"=m."tenantId" AND team.id=m."teamId" AND NOT team.archived WHERE m."tenantId"=NEW."tenantId" AND m."userId"=actor_id AND m."isManager" AND m."teamId"=OLD."salesTeamId"))) THEN
     RAISE EXCEPTION 'Partner correction is outside parent record access' USING ERRCODE='42501';
    END IF;
   END LOOP;
  END IF;
 ELSE permission:='partnerLinks.create'; END IF;
 IF NOT maintenance THEN
  IF TG_OP='INSERT' AND actor_partner IS NOT NULL THEN
   IF NEW."introducedByCollaboratorId" IS NOT NULL AND NEW."introducedByCollaboratorId"<>actor_partner THEN RAISE EXCEPTION 'Introducing collaborator selection is not permitted' USING ERRCODE='42501'; END IF;
   NEW."introducedByCollaboratorId":=actor_partner;
  ELSIF COALESCE(app.partner_permission_scope(NEW."tenantId",permission),'NONE')<>'ALL' OR COALESCE(app.partner_permission_scope(NEW."tenantId",'partnerLinks.read'),'NONE')<>'ALL' OR (NEW."introducedByCollaboratorId" IS NOT NULL AND NOT app.partner_choice_allowed(NEW."tenantId",NEW."introducedByCollaboratorId")) THEN
   RAISE EXCEPTION 'Introducing collaborator selection is not permitted' USING ERRCODE='42501';
  END IF;
 ELSE NEW."introducedByCollaboratorId":=COALESCE(actor_partner,NEW."introducedByCollaboratorId"); END IF;
 IF NEW."introducedByCollaboratorId" IS NULL THEN NEW."partnerAttribution":=NULL; RETURN NEW; END IF;
 SELECT * INTO partner FROM public."ExternalCollaborator" WHERE "tenantId"=NEW."tenantId" AND id=NEW."introducedByCollaboratorId" AND NOT archived FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active introducing collaborator in this workspace' USING ERRCODE='23514'; END IF;
 NEW."partnerAttribution":=jsonb_build_object('version',1,'code',partner.code,'name',partner.name,'supervisorUserId',partner."supervisorUserId");
 RETURN NEW;
END $$;
DROP TRIGGER partner_introduction ON "CrmEnquiry";
DROP TRIGGER partner_introduction ON "CrmOpportunity";
CREATE TRIGGER partner_introduction BEFORE INSERT OR UPDATE ON "CrmEnquiry" FOR EACH ROW EXECUTE FUNCTION app.capture_partner_introduction();
CREATE TRIGGER partner_introduction BEFORE INSERT OR UPDATE ON "CrmOpportunity" FOR EACH ROW EXECUTE FUNCTION app.capture_partner_introduction();

CREATE FUNCTION app.record_partner_link_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE previous jsonb; why text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."introducedByCollaboratorId" IS NOT DISTINCT FROM OLD."introducedByCollaboratorId" THEN RETURN NEW; END IF;
  previous:=OLD."partnerAttribution"; why:=btrim(current_setting('app.partner_change_reason',true));
 ELSE
  IF NEW."introducedByCollaboratorId" IS NULL THEN RETURN NEW; END IF;
  why:=CASE WHEN TG_TABLE_NAME='CrmOpportunity' AND to_jsonb(NEW)->>'enquiryId' IS NOT NULL THEN 'Copied from source enquiry '||(to_jsonb(NEW)->>'enquiryId') ELSE 'Selected at creation' END;
 END IF;
 INSERT INTO public."CrmPartnerLinkEvent"(id,"tenantId","enquiryId","opportunityId","recordVersion","actorUserId",before,after,reason)
 VALUES(gen_random_uuid()::text,NEW."tenantId",CASE WHEN TG_TABLE_NAME='CrmEnquiry' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='CrmOpportunity' THEN NEW.id END,NEW.version,nullif(current_setting('app.actor_id',true),''),previous,NEW."partnerAttribution",why);
 RETURN NEW;
END $$;
CREATE TRIGGER partner_link_history AFTER INSERT OR UPDATE ON "CrmEnquiry" FOR EACH ROW EXECUTE FUNCTION app.record_partner_link_event();
CREATE TRIGGER partner_link_history AFTER INSERT OR UPDATE ON "CrmOpportunity" FOR EACH ROW EXECUTE FUNCTION app.record_partner_link_event();
CREATE FUNCTION app.immutable_partner_link_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Partner history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_partner_link_event BEFORE UPDATE OR DELETE ON "CrmPartnerLinkEvent" FOR EACH ROW EXECUTE FUNCTION app.immutable_partner_link_event();
ALTER TABLE "CrmPartnerLinkEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmPartnerLinkEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY partner_event_read ON "CrmPartnerLinkEvent" FOR SELECT USING (app.tenant_match("tenantId") AND (current_setting('app.rls_bypass',true)='on' OR app.partner_permission_scope("tenantId",'partnerLinks.read')='ALL') AND (EXISTS(SELECT 1 FROM "CrmEnquiry" e WHERE e."tenantId"="CrmPartnerLinkEvent"."tenantId" AND e.id="CrmPartnerLinkEvent"."enquiryId") OR EXISTS(SELECT 1 FROM "CrmOpportunity" o WHERE o."tenantId"="CrmPartnerLinkEvent"."tenantId" AND o.id="CrmPartnerLinkEvent"."opportunityId")));
REVOKE ALL ON FUNCTION app.record_partner_link_event(),app.immutable_partner_link_event() FROM PUBLIC;
-- Helpers expose only bounded choices/scopes, never private directory fields.
COMMIT;
