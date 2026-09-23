BEGIN;
ALTER TABLE "CrmTask" ADD COLUMN "planLaunchId" TEXT, ADD COLUMN "planPosition" INTEGER;
CREATE TABLE "CrmActivityPlan" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "steps" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "archived" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "CrmActivityPlan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrmPlanLaunch" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "planId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "targetKey" TEXT NOT NULL,
  "planName" TEXT NOT NULL, "planVersion" INTEGER NOT NULL, "input" JSONB NOT NULL,
  "steps" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmPlanLaunch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CrmActivityPlan_tenantId_archived_name_idx" ON "CrmActivityPlan"("tenantId", "archived", "name");
CREATE UNIQUE INDEX "CrmActivityPlan_tenantId_id_key" ON "CrmActivityPlan"("tenantId", "id");
CREATE INDEX "CrmPlanLaunch_tenantId_planId_targetKey_idx" ON "CrmPlanLaunch"("tenantId", "planId", "targetKey");
CREATE UNIQUE INDEX "CrmPlanLaunch_tenantId_id_key" ON "CrmPlanLaunch"("tenantId", "id");
CREATE UNIQUE INDEX "CrmPlanLaunch_tenantId_requestKey_key" ON "CrmPlanLaunch"("tenantId", "requestKey");
CREATE UNIQUE INDEX "CrmTask_tenantId_planLaunchId_planPosition_key" ON "CrmTask"("tenantId", "planLaunchId", "planPosition");
ALTER TABLE "CrmActivityPlan" ADD CONSTRAINT "CrmActivityPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmPlanLaunch" ADD CONSTRAINT "CrmPlanLaunch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmPlanLaunch" ADD CONSTRAINT "CrmPlanLaunch_tenantId_planId_fkey" FOREIGN KEY ("tenantId", "planId") REFERENCES "CrmActivityPlan"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmPlanLaunch" ADD CONSTRAINT "CrmPlanLaunch_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_planLaunchId_fkey" FOREIGN KEY ("tenantId", "planLaunchId") REFERENCES "CrmPlanLaunch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmActivityPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmActivityPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmActivityPlan" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmPlanLaunch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmPlanLaunch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmPlanLaunch" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmActivityPlan" ADD CONSTRAINT "CrmActivityPlan_steps_check" CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 12 AND version > 0);
ALTER TABLE "CrmPlanLaunch" ADD CONSTRAINT "CrmPlanLaunch_steps_check" CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 12 AND "planVersion" > 0);
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_plan_origin_check" CHECK (("planLaunchId" IS NULL AND "planPosition" IS NULL) OR ("planLaunchId" IS NOT NULL AND "planPosition" IS NOT NULL AND "planPosition" BETWEEN 0 AND 11));
COMMIT;
