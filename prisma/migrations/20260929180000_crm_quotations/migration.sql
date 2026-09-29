BEGIN;
-- CreateTable
CREATE TABLE "CrmQuotationTemplate" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmQuotationTemplate_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "CrmQuotation" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "consideration" DECIMAL(18,4) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmQuotation_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "CrmQuotationRevision" (
    "tenantId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmQuotationRevision_pkey" PRIMARY KEY ("tenantId","quotationId","number")
);

-- CreateIndex
CREATE INDEX "CrmQuotationTemplate_tenantId_archived_name_id_idx" ON "CrmQuotationTemplate"("tenantId", "archived", "name", "id");

-- CreateIndex
CREATE INDEX "CrmQuotation_tenantId_opportunityId_createdAt_id_idx" ON "CrmQuotation"("tenantId", "opportunityId", "createdAt" DESC, "id");

-- AddForeignKey
ALTER TABLE "CrmQuotationTemplate" ADD CONSTRAINT "CrmQuotationTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotation" ADD CONSTRAINT "CrmQuotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotation" ADD CONSTRAINT "CrmQuotation_tenantId_opportunityId_fkey" FOREIGN KEY ("tenantId", "opportunityId") REFERENCES "CrmOpportunity"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotationRevision" ADD CONSTRAINT "CrmQuotationRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmQuotationRevision" ADD CONSTRAINT "CrmQuotationRevision_tenantId_quotationId_fkey" FOREIGN KEY ("tenantId", "quotationId") REFERENCES "CrmQuotation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CrmQuotationTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmQuotationTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmQuotationTemplate" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmQuotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmQuotation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmQuotation" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmQuotationRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmQuotationRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmQuotationRevision" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmQuotationTemplate" ADD CONSTRAINT "CrmQuotationTemplate_valid" CHECK (version > 0 AND char_length(name) BETWEEN 1 AND 150 AND jsonb_typeof(content)='object');
ALTER TABLE "CrmQuotation" ADD CONSTRAINT "CrmQuotation_valid" CHECK (version > 0 AND consideration > 0 AND currency ~ '^[A-Z]{3}$');
ALTER TABLE "CrmQuotationRevision" ADD CONSTRAINT "CrmQuotationRevision_valid" CHECK (number > 0 AND jsonb_typeof(snapshot)='object');
CREATE FUNCTION app.preserve_quotation_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Saved quotation versions are immutable'; END; $$;
CREATE TRIGGER preserve_quotation_revision BEFORE UPDATE OR DELETE ON "CrmQuotationRevision" FOR EACH ROW EXECUTE FUNCTION app.preserve_quotation_revision();
COMMIT;
