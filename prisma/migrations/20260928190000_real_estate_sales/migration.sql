BEGIN;

-- CreateTable
CREATE TABLE "RealEstateEnquiryContext" (
    "tenantId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "projectId" TEXT,
    "subprojectId" TEXT,
    "budgetMin" DECIMAL(18,4),
    "budgetMax" DECIMAL(18,4),
    "budgetCurrency" TEXT,
    "propertyCategory" TEXT,
    "bedrooms" INTEGER,
    "buyingTimeframe" TEXT,

    CONSTRAINT "RealEstateEnquiryContext_pkey" PRIMARY KEY ("tenantId","enquiryId")
);

-- CreateTable
CREATE TABLE "RealEstateOpportunityContext" (
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "projectId" TEXT,
    "subprojectId" TEXT,
    "budgetMin" DECIMAL(18,4),
    "budgetMax" DECIMAL(18,4),
    "budgetCurrency" TEXT,
    "propertyCategory" TEXT,
    "bedrooms" INTEGER,
    "buyingTimeframe" TEXT,

    CONSTRAINT "RealEstateOpportunityContext_pkey" PRIMARY KEY ("tenantId","opportunityId")
);

-- CreateIndex
CREATE INDEX "RealEstateEnquiryContext_tenantId_projectId_subprojectId_idx" ON "RealEstateEnquiryContext"("tenantId", "projectId", "subprojectId");

-- CreateIndex
CREATE INDEX "RealEstateOpportunityContext_tenantId_projectId_subprojectI_idx" ON "RealEstateOpportunityContext"("tenantId", "projectId", "subprojectId");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateProject_tenantId_parentId_id_key" ON "RealEstateProject"("tenantId", "parentId", "id");

-- AddForeignKey
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_enquiryId_fkey" FOREIGN KEY ("tenantId", "enquiryId") REFERENCES "CrmEnquiry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "RealEstateProject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_tenantId_projectId_subprojectId_fkey" FOREIGN KEY ("tenantId", "projectId", "subprojectId") REFERENCES "RealEstateProject"("tenantId", "parentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_opportunityId_fkey" FOREIGN KEY ("tenantId", "opportunityId") REFERENCES "CrmOpportunity"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "RealEstateProject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_tenantId_projectId_subproject_fkey" FOREIGN KEY ("tenantId", "projectId", "subprojectId") REFERENCES "RealEstateProject"("tenantId", "parentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "RealEstateEnquiryContext" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateEnquiryContext" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateEnquiryContext" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateOpportunityContext" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateOpportunityContext" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateOpportunityContext" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));

ALTER TABLE "RealEstateEnquiryContext" ADD CONSTRAINT "RealEstateEnquiryContext_requirements_check" CHECK (
  ("subprojectId" IS NULL OR "projectId" IS NOT NULL)
  AND ("budgetMin" IS NULL OR "budgetMin" >= 0)
  AND ("budgetMax" IS NULL OR "budgetMax" >= 0)
  AND ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
  AND (("budgetMin" IS NULL AND "budgetMax" IS NULL) OR "budgetCurrency" IS NOT NULL)
  AND ("budgetCurrency" IS NULL OR "budgetCurrency" ~ '^[A-Z]{3}$')
  AND ("bedrooms" IS NULL OR "bedrooms" BETWEEN 0 AND 50)
  AND ("propertyCategory" IS NULL OR "propertyCategory" IN ('APARTMENT','VILLA','PLOT','OFFICE','RETAIL','INDUSTRIAL','MIXED_USE','OTHER'))
  AND ("buyingTimeframe" IS NULL OR "buyingTimeframe" IN ('ASAP','WITHIN_3_MONTHS','3_TO_6_MONTHS','6_TO_12_MONTHS','OVER_12_MONTHS','EXPLORING'))
);
ALTER TABLE "RealEstateOpportunityContext" ADD CONSTRAINT "RealEstateOpportunityContext_requirements_check" CHECK (
  ("subprojectId" IS NULL OR "projectId" IS NOT NULL)
  AND ("budgetMin" IS NULL OR "budgetMin" >= 0)
  AND ("budgetMax" IS NULL OR "budgetMax" >= 0)
  AND ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
  AND (("budgetMin" IS NULL AND "budgetMax" IS NULL) OR "budgetCurrency" IS NOT NULL)
  AND ("budgetCurrency" IS NULL OR "budgetCurrency" ~ '^[A-Z]{3}$')
  AND ("bedrooms" IS NULL OR "bedrooms" BETWEEN 0 AND 50)
  AND ("propertyCategory" IS NULL OR "propertyCategory" IN ('APARTMENT','VILLA','PLOT','OFFICE','RETAIL','INDUSTRIAL','MIXED_USE','OTHER'))
  AND ("buyingTimeframe" IS NULL OR "buyingTimeframe" IN ('ASAP','WITHIN_3_MONTHS','3_TO_6_MONTHS','6_TO_12_MONTHS','OVER_12_MONTHS','EXPLORING'))
);

COMMIT;
