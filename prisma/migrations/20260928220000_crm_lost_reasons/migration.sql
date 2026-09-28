BEGIN;
-- Additive migration: legacy closing notes remain unchanged and unclassified.
-- AlterTable
ALTER TABLE "CrmOpportunity" ADD COLUMN     "lostReasonId" TEXT,
ADD COLUMN     "lostReasonName" TEXT;

-- AlterTable
ALTER TABLE "CrmEnquiry" ADD COLUMN     "lostReasonId" TEXT,
ADD COLUMN     "lostReasonName" TEXT;

-- CreateTable
CREATE TABLE "CrmLostReason" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLostReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmLostReason_tenantId_archived_name_idx" ON "CrmLostReason"("tenantId", "archived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLostReason_tenantId_id_key" ON "CrmLostReason"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLostReason_tenantId_nameKey_key" ON "CrmLostReason"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_lostReasonId_idx" ON "CrmOpportunity"("tenantId", "lostReasonId");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_lostReasonId_idx" ON "CrmEnquiry"("tenantId", "lostReasonId");

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_lostReasonId_fkey" FOREIGN KEY ("tenantId", "lostReasonId") REFERENCES "CrmLostReason"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLostReason" ADD CONSTRAINT "CrmLostReason_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_lostReasonId_fkey" FOREIGN KEY ("tenantId", "lostReasonId") REFERENCES "CrmLostReason"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmLostReason" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmLostReason" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmLostReason" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmLostReason" ADD CONSTRAINT "CrmLostReason_version_check" CHECK (version > 0);
COMMIT;
