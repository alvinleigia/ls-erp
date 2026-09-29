BEGIN;
-- Additive: existing records retain their workflow and access with a NULL team.
-- AlterTable
ALTER TABLE "CrmOpportunity" ADD COLUMN     "salesTeamId" TEXT;

-- AlterTable
ALTER TABLE "CrmEnquiry" ADD COLUMN     "salesTeamId" TEXT;

-- AlterTable
ALTER TABLE "CustomFieldDefinition" ADD COLUMN     "salesTeamId" TEXT;

-- CreateTable
CREATE TABLE "CrmSalesTeam" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "workflow" TEXT NOT NULL DEFAULT 'ENQUIRY_FIRST',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSalesTeam_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "CrmSalesTeamMember" (
    "tenantId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CrmSalesTeamMember_pkey" PRIMARY KEY ("tenantId","teamId","userId")
);

-- CreateIndex
CREATE INDEX "CrmSalesTeam_tenantId_archived_name_id_idx" ON "CrmSalesTeam"("tenantId", "archived", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSalesTeam_tenantId_nameKey_key" ON "CrmSalesTeam"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "CrmSalesTeamMember_tenantId_userId_teamId_idx" ON "CrmSalesTeamMember"("tenantId", "userId", "teamId");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_salesTeamId_idx" ON "CrmOpportunity"("tenantId", "salesTeamId");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_salesTeamId_idx" ON "CrmEnquiry"("tenantId", "salesTeamId");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_tenantId_salesTeamId_idx" ON "CustomFieldDefinition"("tenantId", "salesTeamId");

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_salesTeamId_fkey" FOREIGN KEY ("tenantId", "salesTeamId") REFERENCES "CrmSalesTeam"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_salesTeamId_fkey" FOREIGN KEY ("tenantId", "salesTeamId") REFERENCES "CrmSalesTeam"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_tenantId_salesTeamId_fkey" FOREIGN KEY ("tenantId", "salesTeamId") REFERENCES "CrmSalesTeam"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSalesTeam" ADD CONSTRAINT "CrmSalesTeam_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSalesTeamMember" ADD CONSTRAINT "CrmSalesTeamMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSalesTeamMember" ADD CONSTRAINT "CrmSalesTeamMember_tenantId_teamId_fkey" FOREIGN KEY ("tenantId", "teamId") REFERENCES "CrmSalesTeam"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSalesTeamMember" ADD CONSTRAINT "CrmSalesTeamMember_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmSalesTeam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmSalesTeam" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmSalesTeam" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmSalesTeamMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmSalesTeamMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmSalesTeamMember" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmSalesTeam" ADD CONSTRAINT "CrmSalesTeam_valid" CHECK (workflow IN ('ENQUIRY_FIRST','DIRECT') AND version > 0 AND char_length(name) BETWEEN 1 AND 100 AND "nameKey"=lower(name));
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_team_scope" CHECK ("salesTeamId" IS NULL OR scope IN ('ENQUIRY','OPPORTUNITY','SALES'));
COMMIT;
