-- CreateEnum
CREATE TYPE "CrmEnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED');

-- CreateTable
CREATE TABLE "TenantModule" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "legacyUserId" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmEnquiry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT,
    "requirements" TEXT,
    "assignedUserId" TEXT NOT NULL,
    "status" "CrmEnquiryStatus" NOT NULL DEFAULT 'NEW',
    "outcome" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmContact_tenantId_ownerUserId_idx" ON "CrmContact"("tenantId", "ownerUserId");

-- CreateIndex
CREATE INDEX "CrmContact_tenantId_name_idx" ON "CrmContact"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenantId_id_key" ON "CrmContact"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenantId_email_key" ON "CrmContact"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenantId_phone_key" ON "CrmContact"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_tenantId_legacyUserId_key" ON "CrmContact"("tenantId", "legacyUserId");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_assignedUserId_status_idx" ON "CrmEnquiry"("tenantId", "assignedUserId", "status");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_contactId_idx" ON "CrmEnquiry"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_updatedAt_idx" ON "CrmEnquiry"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEnquiry_tenantId_id_key" ON "CrmEnquiry"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_enquiryId_idx" ON "CrmTask"("tenantId", "enquiryId");

-- CreateIndex
CREATE INDEX "CrmTask_tenantId_completedAt_dueOn_idx" ON "CrmTask"("tenantId", "completedAt", "dueOn");

-- CreateIndex
CREATE INDEX "CrmActivity_tenantId_enquiryId_createdAt_idx" ON "CrmActivity"("tenantId", "enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_tenantId_ownerUserId_fkey" FOREIGN KEY ("tenantId", "ownerUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_tenantId_legacyUserId_fkey" FOREIGN KEY ("tenantId", "legacyUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "CrmContact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_assignedUserId_fkey" FOREIGN KEY ("tenantId", "assignedUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_tenantId_enquiryId_fkey" FOREIGN KEY ("tenantId", "enquiryId") REFERENCES "CrmEnquiry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_tenantId_enquiryId_fkey" FOREIGN KEY ("tenantId", "enquiryId") REFERENCES "CrmEnquiry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_tenantId_actorUserId_fkey" FOREIGN KEY ("tenantId", "actorUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract. Composite foreign keys above also
-- prevent cross-tenant relationships when privileged maintenance bypasses RLS.
ALTER TABLE "TenantModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantModule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "TenantModule" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmContact" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmEnquiry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmEnquiry" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmEnquiry" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmTask" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmActivity" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
