BEGIN;

CREATE TABLE "CrmOpportunityParticipant" (
 id text PRIMARY KEY,
 "tenantId" text NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "opportunityId" text NOT NULL,
 role text NOT NULL CHECK (role IN ('ADDITIONAL_CUSTOMER','REPRESENTATIVE')),
 "contactId" text,
 "accountId" text,
 position integer NOT NULL CHECK (position BETWEEN 0 AND 97),
 details jsonb NOT NULL CHECK (jsonb_typeof(details)='object'),
 CHECK (("contactId" IS NOT NULL)::int + ("accountId" IS NOT NULL)::int = 1),
 FOREIGN KEY ("tenantId","opportunityId") REFERENCES "CrmOpportunity"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","contactId") REFERENCES "CrmContact"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","accountId") REFERENCES "CrmAccount"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CrmOpportunityParticipant_tenantId_id_key" ON "CrmOpportunityParticipant"("tenantId",id);
CREATE UNIQUE INDEX "CrmOpportunityParticipant_tenantId_opportunityId_position_key" ON "CrmOpportunityParticipant"("tenantId","opportunityId",position);
CREATE UNIQUE INDEX "CrmOpportunityParticipant_tenantId_opportunityId_contactId__key" ON "CrmOpportunityParticipant"("tenantId","opportunityId","contactId",role);
CREATE UNIQUE INDEX "CrmOpportunityParticipant_tenantId_opportunityId_accountId__key" ON "CrmOpportunityParticipant"("tenantId","opportunityId","accountId",role);
CREATE INDEX "CrmOpportunityParticipant_tenantId_contactId_idx" ON "CrmOpportunityParticipant"("tenantId","contactId");
CREATE INDEX "CrmOpportunityParticipant_tenantId_accountId_idx" ON "CrmOpportunityParticipant"("tenantId","accountId");

CREATE FUNCTION app.participant_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."opportunityId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."opportunityId") THEN
  RAISE EXCEPTION 'Participant source identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER participant_source_immutable BEFORE UPDATE ON "CrmOpportunityParticipant" FOR EACH ROW EXECUTE FUNCTION app.participant_source_immutable();

ALTER TABLE "CrmOpportunityParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmOpportunityParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmOpportunityParticipant" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
-- Saved evidence inherits source office and privacy, independent of master
-- directory visibility. No new grants, definer lookups or policy replacements.
CREATE POLICY source_read ON "CrmOpportunityParticipant" AS RESTRICTIVE FOR ALL USING (
 current_setting('app.rls_bypass',true)='on' OR "opportunityId" IN (
  SELECT id FROM "CrmOpportunity" WHERE "tenantId"=nullif(current_setting('app.tenant_id',true),'')
 )
);
CREATE POLICY source_insert ON "CrmOpportunityParticipant" AS RESTRICTIVE FOR INSERT WITH CHECK (
 app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",nullif(current_setting('app.actor_id',true),''),'EDIT')
);
CREATE POLICY source_update ON "CrmOpportunityParticipant" AS RESTRICTIVE FOR UPDATE USING (
 app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",nullif(current_setting('app.actor_id',true),''),'EDIT')
);
CREATE POLICY source_delete ON "CrmOpportunityParticipant" AS RESTRICTIVE FOR DELETE USING (
 app.record_sharing_allowed("tenantId",'opportunities',"opportunityId",nullif(current_setting('app.actor_id',true),''),'EDIT')
);
-- Existing runtime roles have default table privileges; keep explicit grants
-- consistent with previous tenant tables when those roles already exist.
DO $$ DECLARE who text; BEGIN
 FOREACH who IN ARRAY ARRAY['prisma_app','crm_test_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=who) THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON "CrmOpportunityParticipant" TO %I',who);
  END IF;
 END LOOP;
END $$;

COMMIT;
