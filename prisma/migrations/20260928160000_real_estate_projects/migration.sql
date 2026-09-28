BEGIN;
-- CreateTable
CREATE TABLE "RealEstateProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "developerAccountId" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lifecycle" TEXT NOT NULL DEFAULT 'PLANNING',
    "priceMin" DECIMAL(18,4),
    "priceMax" DECIMAL(18,4),
    "currency" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RealEstateProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealEstateProjectMember" (
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealEstateProjectMember_pkey" PRIMARY KEY ("tenantId","projectId","userId")
);

-- CreateIndex
CREATE INDEX "RealEstateProject_tenantId_parentId_archived_name_idx" ON "RealEstateProject"("tenantId", "parentId", "archived", "name");

-- CreateIndex
CREATE INDEX "RealEstateProject_tenantId_developerAccountId_idx" ON "RealEstateProject"("tenantId", "developerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateProject_tenantId_id_key" ON "RealEstateProject"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RealEstateProject_tenantId_code_key" ON "RealEstateProject"("tenantId", "code");

-- CreateIndex
CREATE INDEX "RealEstateProjectMember_tenantId_userId_idx" ON "RealEstateProjectMember"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_parentId_fkey" FOREIGN KEY ("tenantId", "parentId") REFERENCES "RealEstateProject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_developerAccountId_fkey" FOREIGN KEY ("tenantId", "developerAccountId") REFERENCES "CrmAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectMember" ADD CONSTRAINT "RealEstateProjectMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectMember" ADD CONSTRAINT "RealEstateProjectMember_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "RealEstateProject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectMember" ADD CONSTRAINT "RealEstateProjectMember_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Match the existing tenant RLS contract.
ALTER TABLE "RealEstateProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateProject" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateProject" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateProjectMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateProjectMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateProjectMember" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_version_check" CHECK (version > 0);
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> id);
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_code_check" CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$');
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_lifecycle_check" CHECK (lifecycle IN ('PLANNING', 'PRE_LAUNCH', 'SELLING', 'ON_HOLD', 'CLOSED'));
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_price_check" CHECK (
  ("priceMin" IS NULL OR "priceMin" >= 0) AND ("priceMax" IS NULL OR "priceMax" >= 0)
  AND ("priceMin" IS NULL OR "priceMax" IS NULL OR "priceMin" <= "priceMax")
  AND (("priceMin" IS NULL AND "priceMax" IS NULL) OR currency IS NOT NULL)
  AND (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);
COMMIT;