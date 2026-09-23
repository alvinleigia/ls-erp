-- CreateEnum
CREATE TYPE "CrmStageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "CrmPipeline" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmStage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CrmStageKind" NOT NULL DEFAULT 'OPEN',
    "probability" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrmStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOpportunity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT,
    "enquiryId" TEXT,
    "assignedUserId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "probability" INTEGER NOT NULL,
    "expectedCloseOn" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lossReason" TEXT,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOpportunityActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmOpportunityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmPipeline_tenantId_archived_name_idx" ON "CrmPipeline"("tenantId", "archived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPipeline_tenantId_id_key" ON "CrmPipeline"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CrmStage_tenantId_pipelineId_position_idx" ON "CrmStage"("tenantId", "pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CrmStage_tenantId_pipelineId_id_key" ON "CrmStage"("tenantId", "pipelineId", "id");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_pipelineId_stageId_updatedAt_idx" ON "CrmOpportunity"("tenantId", "pipelineId", "stageId", "updatedAt");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_assignedUserId_expectedCloseOn_idx" ON "CrmOpportunity"("tenantId", "assignedUserId", "expectedCloseOn");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_contactId_idx" ON "CrmOpportunity"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "CrmOpportunity_tenantId_accountId_idx" ON "CrmOpportunity"("tenantId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOpportunity_tenantId_id_key" ON "CrmOpportunity"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOpportunity_tenantId_enquiryId_key" ON "CrmOpportunity"("tenantId", "enquiryId");

-- CreateIndex
CREATE INDEX "CrmOpportunityActivity_tenantId_opportunityId_createdAt_idx" ON "CrmOpportunityActivity"("tenantId", "opportunityId", "createdAt");

-- AddForeignKey
ALTER TABLE "CrmPipeline" ADD CONSTRAINT "CrmPipeline_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_tenantId_pipelineId_fkey" FOREIGN KEY ("tenantId", "pipelineId") REFERENCES "CrmPipeline"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_pipelineId_fkey" FOREIGN KEY ("tenantId", "pipelineId") REFERENCES "CrmPipeline"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_pipelineId_stageId_fkey" FOREIGN KEY ("tenantId", "pipelineId", "stageId") REFERENCES "CrmStage"("tenantId", "pipelineId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "CrmContact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_accountId_fkey" FOREIGN KEY ("tenantId", "accountId") REFERENCES "CrmAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_enquiryId_fkey" FOREIGN KEY ("tenantId", "enquiryId") REFERENCES "CrmEnquiry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_assignedUserId_fkey" FOREIGN KEY ("tenantId", "assignedUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityActivity" ADD CONSTRAINT "CrmOpportunityActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityActivity" ADD CONSTRAINT "CrmOpportunityActivity_tenantId_opportunityId_fkey" FOREIGN KEY ("tenantId", "opportunityId") REFERENCES "CrmOpportunity"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityActivity" ADD CONSTRAINT "CrmOpportunityActivity_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmPipeline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmPipeline" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmPipeline" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmStage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmStage" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmOpportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmOpportunity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmOpportunity" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmOpportunityActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmOpportunityActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmOpportunityActivity" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));

ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_probability_check" CHECK ((kind = 'WON' AND probability = 100) OR (kind = 'LOST' AND probability = 0) OR (kind = 'OPEN' AND probability BETWEEN 0 AND 99));
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_probability_check" CHECK (probability BETWEEN 0 AND 100);
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_amount_check" CHECK (amount >= 0);
