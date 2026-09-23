-- CreateTable
CREATE TABLE "CrmAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmAccountContact" (
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmAccountContact_pkey" PRIMARY KEY ("tenantId","accountId","contactId")
);

-- CreateIndex
CREATE INDEX "CrmAccount_tenantId_ownerUserId_idx" ON "CrmAccount"("tenantId", "ownerUserId");

-- CreateIndex
CREATE INDEX "CrmAccount_tenantId_name_idx" ON "CrmAccount"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmAccount_tenantId_id_key" ON "CrmAccount"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CrmAccountContact_tenantId_contactId_idx" ON "CrmAccountContact"("tenantId", "contactId");

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccount" ADD CONSTRAINT "CrmAccount_tenantId_ownerUserId_fkey" FOREIGN KEY ("tenantId", "ownerUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccountContact" ADD CONSTRAINT "CrmAccountContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccountContact" ADD CONSTRAINT "CrmAccountContact_tenantId_accountId_fkey" FOREIGN KEY ("tenantId", "accountId") REFERENCES "CrmAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmAccountContact" ADD CONSTRAINT "CrmAccountContact_tenantId_contactId_fkey" FOREIGN KEY ("tenantId", "contactId") REFERENCES "CrmContact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmAccount" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmAccountContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmAccountContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrmAccountContact" FOR ALL
  USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
