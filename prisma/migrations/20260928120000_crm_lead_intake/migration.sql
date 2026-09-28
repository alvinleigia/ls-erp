BEGIN;
-- AlterTable
ALTER TABLE "CrmOpportunity" ADD COLUMN     "referralAccountId" TEXT,
ADD COLUMN     "referralContactId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceId" TEXT;

-- AlterTable
ALTER TABLE "CrmContact" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "whatsappPhone" TEXT;

-- AlterTable
ALTER TABLE "CrmEnquiry" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "referralAccountId" TEXT,
ADD COLUMN     "referralContactId" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "targetCloseOn" DATE;

-- CreateTable
CREATE TABLE "CrmLeadSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmLeadSource_tenantId_archived_name_idx" ON "CrmLeadSource"("tenantId", "archived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLeadSource_tenantId_id_key" ON "CrmLeadSource"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLeadSource_tenantId_nameKey_key" ON "CrmLeadSource"("tenantId", "nameKey");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_sourceId_assignedUserId_idx" ON "CrmEnquiry"("tenantId", "sourceId", "assignedUserId");

-- CreateIndex
CREATE INDEX "CrmEnquiry_tenantId_accountId_idx" ON "CrmEnquiry"("tenantId", "accountId");

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "CrmLeadSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_referralContactId_fkey" FOREIGN KEY ("tenantId", "referralContactId") REFERENCES "CrmContact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_tenantId_referralAccountId_fkey" FOREIGN KEY ("tenantId", "referralAccountId") REFERENCES "CrmAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLeadSource" ADD CONSTRAINT "CrmLeadSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_sourceId_fkey" FOREIGN KEY ("tenantId", "sourceId") REFERENCES "CrmLeadSource"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_accountId_fkey" FOREIGN KEY ("tenantId", "accountId") REFERENCES "CrmAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_referralContactId_fkey" FOREIGN KEY ("tenantId", "referralContactId") REFERENCES "CrmContact"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_tenantId_referralAccountId_fkey" FOREIGN KEY ("tenantId", "referralAccountId") REFERENCES "CrmAccount"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve original source text; only group spelling/spacing variants per tenant.
SELECT set_config('app.rls_bypass', 'on', true);
INSERT INTO "CrmLeadSource" (id, "tenantId", name, "nameKey", "updatedAt")
SELECT 'legacy_source_' || md5("tenantId" || ':' || lower(regexp_replace(btrim(source), '\s+', ' ', 'g'))),
       "tenantId", min(regexp_replace(btrim(source), '\s+', ' ', 'g')),
       lower(regexp_replace(btrim(source), '\s+', ' ', 'g')), CURRENT_TIMESTAMP
FROM "CrmEnquiry" WHERE source IS NOT NULL AND btrim(source) <> ''
GROUP BY "tenantId", lower(regexp_replace(btrim(source), '\s+', ' ', 'g'))
ON CONFLICT ("tenantId", "nameKey") DO NOTHING;
UPDATE "CrmEnquiry" e SET "sourceId" = s.id FROM "CrmLeadSource" s
WHERE e."tenantId" = s."tenantId" AND e."sourceId" IS NULL
AND lower(regexp_replace(btrim(e.source), '\s+', ' ', 'g')) = s."nameKey";
UPDATE "CrmOpportunity" o SET "sourceId" = e."sourceId", source = e.source
FROM "CrmEnquiry" e WHERE o."tenantId" = e."tenantId" AND o."enquiryId" = e.id
AND o."sourceId" IS NULL AND o.source IS NULL;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmLeadSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmLeadSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmLeadSource" FOR ALL USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmLeadSource" ADD CONSTRAINT "CrmLeadSource_version_check" CHECK (version > 0);
ALTER TABLE "CrmEnquiry" ADD CONSTRAINT "CrmEnquiry_one_referrer_check" CHECK ("referralContactId" IS NULL OR "referralAccountId" IS NULL);
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_one_referrer_check" CHECK ("referralContactId" IS NULL OR "referralAccountId" IS NULL);
COMMIT;
