BEGIN;
ALTER TABLE "CrmTask" ADD COLUMN "followUpRuleId" TEXT,
  ADD COLUMN "followUpRuleName" TEXT, ADD COLUMN "followUpRuleVersion" INTEGER,
  ADD COLUMN "automationDepth" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "CrmFollowUpRule" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "sourceType" "CrmWorkType" NOT NULL, "outcome" TEXT NOT NULL, "nextStep" JSONB NOT NULL,
  "maxDepth" INTEGER NOT NULL DEFAULT 3, "archived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CrmFollowUpRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrmFollowUpRule_tenantId_id_key" ON "CrmFollowUpRule"("tenantId", "id");
CREATE UNIQUE INDEX "CrmFollowUpRule_tenantId_sourceType_outcome_key" ON "CrmFollowUpRule"("tenantId", "sourceType", "outcome");
CREATE INDEX "CrmFollowUpRule_tenantId_archived_name_idx" ON "CrmFollowUpRule"("tenantId", "archived", "name");
ALTER TABLE "CrmFollowUpRule" ADD CONSTRAINT "CrmFollowUpRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_followUpRuleId_fkey" FOREIGN KEY ("tenantId", "followUpRuleId") REFERENCES "CrmFollowUpRule"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmFollowUpRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmFollowUpRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmFollowUpRule" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmFollowUpRule" ADD CONSTRAINT "CrmFollowUpRule_limits_check" CHECK ("maxDepth" BETWEEN 1 AND 10 AND version > 0 AND jsonb_typeof("nextStep") = 'object');
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_rule_origin_check" CHECK (
  ("followUpRuleId" IS NULL AND "followUpRuleName" IS NULL AND "followUpRuleVersion" IS NULL AND "automationDepth" = 0)
  OR ("followUpRuleId" IS NOT NULL AND "followUpRuleName" IS NOT NULL AND "followUpRuleVersion" IS NOT NULL AND "followUpRuleVersion" > 0 AND "automationDepth" BETWEEN 1 AND 10 AND "planLaunchId" IS NULL AND "followUpOfId" IS NOT NULL)
);
COMMIT;
