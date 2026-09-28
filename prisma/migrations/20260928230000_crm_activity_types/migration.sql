BEGIN;
-- Existing activities retain their built-in behaviour and history.
-- AlterTable
ALTER TABLE "CrmTask" ADD COLUMN     "activityTypeId" TEXT,
ADD COLUMN     "activityTypeName" TEXT;

-- CreateTable
CREATE TABLE "CrmActivityType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "baseType" "CrmWorkType" NOT NULL,
    "defaultInstructions" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmActivityType_tenantId_archived_name_idx" ON "CrmActivityType"("tenantId", "archived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmActivityType_tenantId_id_key" ON "CrmActivityType"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmActivityType_tenantId_nameKey_key" ON "CrmActivityType"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_activityTypeId_status_dueOn_idx" ON "CrmTask"("tenantId", "activityTypeId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_activityTypeId_completedAt_idx" ON "CrmTask"("tenantId", "activityTypeId", "completedAt");

-- AddForeignKey
ALTER TABLE "CrmActivityType" ADD CONSTRAINT "CrmActivityType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_activityTypeId_fkey" FOREIGN KEY ("tenantId", "activityTypeId") REFERENCES "CrmActivityType"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmActivityType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmActivityType" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmActivityType" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmActivityType" ADD CONSTRAINT "CrmActivityType_version_check" CHECK (version > 0);
COMMIT;
