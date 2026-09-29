BEGIN;
-- AlterTable
ALTER TABLE "CrmOpportunity" ADD COLUMN     "customFieldsCreatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "helpText" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "requiredSince" TIMESTAMP(3),
    "visibility" TEXT NOT NULL DEFAULT 'ALL',
    "editability" TEXT NOT NULL DEFAULT 'ALL',
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "maxLength" INTEGER NOT NULL DEFAULT 2000,
    "minimum" DECIMAL(24,6),
    "maximum" DECIMAL(24,6),
    "defaultValue" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("tenantId","id")
);

-- CreateTable
CREATE TABLE "CustomFieldOption" (
    "tenantId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomFieldOption_pkey" PRIMARY KEY ("tenantId","fieldId","id")
);

-- CreateTable
CREATE TABLE "CrmEnquiryFieldValue" (
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "textValue" TEXT,
    "textKey" TEXT,
    "numberValue" DECIMAL(24,6),
    "dateValue" DATE,
    "booleanValue" BOOLEAN,
    "optionId" TEXT,
    "fieldName" TEXT NOT NULL,
    "optionName" TEXT,

    CONSTRAINT "CrmEnquiryFieldValue_pkey" PRIMARY KEY ("tenantId","recordId","fieldId")
);

-- CreateTable
CREATE TABLE "CrmOpportunityFieldValue" (
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "textValue" TEXT,
    "textKey" TEXT,
    "numberValue" DECIMAL(24,6),
    "dateValue" DATE,
    "booleanValue" BOOLEAN,
    "optionId" TEXT,
    "fieldName" TEXT NOT NULL,
    "optionName" TEXT,

    CONSTRAINT "CrmOpportunityFieldValue_pkey" PRIMARY KEY ("tenantId","recordId","fieldId")
);

-- CreateTable
CREATE TABLE "RealEstateProjectFieldValue" (
    "tenantId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "textValue" TEXT,
    "textKey" TEXT,
    "numberValue" DECIMAL(24,6),
    "dateValue" DATE,
    "booleanValue" BOOLEAN,
    "optionId" TEXT,
    "fieldName" TEXT NOT NULL,
    "optionName" TEXT,

    CONSTRAINT "RealEstateProjectFieldValue_pkey" PRIMARY KEY ("tenantId","recordId","fieldId")
);

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_tenantId_scope_archived_position_id_idx" ON "CustomFieldDefinition"("tenantId", "scope", "archived", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_tenantId_scope_code_key" ON "CustomFieldDefinition"("tenantId", "scope", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_tenantId_id_scope_type_key" ON "CustomFieldDefinition"("tenantId", "id", "scope", "type");

-- CreateIndex
CREATE INDEX "CustomFieldOption_tenantId_fieldId_archived_position_id_idx" ON "CustomFieldOption"("tenantId", "fieldId", "archived", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldOption_tenantId_fieldId_name_key" ON "CustomFieldOption"("tenantId", "fieldId", "name");

-- CreateIndex
CREATE INDEX "CrmEnquiryFieldValue_tenantId_fieldId_textKey_recordId_idx" ON "CrmEnquiryFieldValue"("tenantId", "fieldId", "textKey", "recordId");

-- CreateIndex
CREATE INDEX "CrmEnquiryFieldValue_tenantId_fieldId_numberValue_recordId_idx" ON "CrmEnquiryFieldValue"("tenantId", "fieldId", "numberValue", "recordId");

-- CreateIndex
CREATE INDEX "CrmEnquiryFieldValue_tenantId_fieldId_dateValue_recordId_idx" ON "CrmEnquiryFieldValue"("tenantId", "fieldId", "dateValue", "recordId");

-- CreateIndex
CREATE INDEX "CrmEnquiryFieldValue_tenantId_fieldId_booleanValue_recordId_idx" ON "CrmEnquiryFieldValue"("tenantId", "fieldId", "booleanValue", "recordId");

-- CreateIndex
CREATE INDEX "CrmEnquiryFieldValue_tenantId_fieldId_optionId_recordId_idx" ON "CrmEnquiryFieldValue"("tenantId", "fieldId", "optionId", "recordId");

-- CreateIndex
CREATE INDEX "CrmOpportunityFieldValue_tenantId_fieldId_textKey_recordId_idx" ON "CrmOpportunityFieldValue"("tenantId", "fieldId", "textKey", "recordId");

-- CreateIndex
CREATE INDEX "CrmOpportunityFieldValue_tenantId_fieldId_numberValue_recor_idx" ON "CrmOpportunityFieldValue"("tenantId", "fieldId", "numberValue", "recordId");

-- CreateIndex
CREATE INDEX "CrmOpportunityFieldValue_tenantId_fieldId_dateValue_recordI_idx" ON "CrmOpportunityFieldValue"("tenantId", "fieldId", "dateValue", "recordId");

-- CreateIndex
CREATE INDEX "CrmOpportunityFieldValue_tenantId_fieldId_booleanValue_reco_idx" ON "CrmOpportunityFieldValue"("tenantId", "fieldId", "booleanValue", "recordId");

-- CreateIndex
CREATE INDEX "CrmOpportunityFieldValue_tenantId_fieldId_optionId_recordId_idx" ON "CrmOpportunityFieldValue"("tenantId", "fieldId", "optionId", "recordId");

-- CreateIndex
CREATE INDEX "RealEstateProjectFieldValue_tenantId_fieldId_textKey_record_idx" ON "RealEstateProjectFieldValue"("tenantId", "fieldId", "textKey", "recordId");

-- CreateIndex
CREATE INDEX "RealEstateProjectFieldValue_tenantId_fieldId_numberValue_re_idx" ON "RealEstateProjectFieldValue"("tenantId", "fieldId", "numberValue", "recordId");

-- CreateIndex
CREATE INDEX "RealEstateProjectFieldValue_tenantId_fieldId_dateValue_reco_idx" ON "RealEstateProjectFieldValue"("tenantId", "fieldId", "dateValue", "recordId");

-- CreateIndex
CREATE INDEX "RealEstateProjectFieldValue_tenantId_fieldId_booleanValue_r_idx" ON "RealEstateProjectFieldValue"("tenantId", "fieldId", "booleanValue", "recordId");

-- CreateIndex
CREATE INDEX "RealEstateProjectFieldValue_tenantId_fieldId_optionId_recor_idx" ON "RealEstateProjectFieldValue"("tenantId", "fieldId", "optionId", "recordId");

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_tenantId_fieldId_fkey" FOREIGN KEY ("tenantId", "fieldId") REFERENCES "CustomFieldDefinition"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiryFieldValue" ADD CONSTRAINT "CrmEnquiryFieldValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiryFieldValue" ADD CONSTRAINT "CrmEnquiryFieldValue_tenantId_recordId_fkey" FOREIGN KEY ("tenantId", "recordId") REFERENCES "CrmEnquiry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiryFieldValue" ADD CONSTRAINT "CrmEnquiryFieldValue_tenantId_fieldId_scope_type_fkey" FOREIGN KEY ("tenantId", "fieldId", "scope", "type") REFERENCES "CustomFieldDefinition"("tenantId", "id", "scope", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEnquiryFieldValue" ADD CONSTRAINT "CrmEnquiryFieldValue_tenantId_fieldId_optionId_fkey" FOREIGN KEY ("tenantId", "fieldId", "optionId") REFERENCES "CustomFieldOption"("tenantId", "fieldId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityFieldValue" ADD CONSTRAINT "CrmOpportunityFieldValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityFieldValue" ADD CONSTRAINT "CrmOpportunityFieldValue_tenantId_recordId_fkey" FOREIGN KEY ("tenantId", "recordId") REFERENCES "CrmOpportunity"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityFieldValue" ADD CONSTRAINT "CrmOpportunityFieldValue_tenantId_fieldId_scope_type_fkey" FOREIGN KEY ("tenantId", "fieldId", "scope", "type") REFERENCES "CustomFieldDefinition"("tenantId", "id", "scope", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOpportunityFieldValue" ADD CONSTRAINT "CrmOpportunityFieldValue_tenantId_fieldId_optionId_fkey" FOREIGN KEY ("tenantId", "fieldId", "optionId") REFERENCES "CustomFieldOption"("tenantId", "fieldId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectFieldValue" ADD CONSTRAINT "RealEstateProjectFieldValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectFieldValue" ADD CONSTRAINT "RealEstateProjectFieldValue_tenantId_recordId_fkey" FOREIGN KEY ("tenantId", "recordId") REFERENCES "RealEstateProject"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectFieldValue" ADD CONSTRAINT "RealEstateProjectFieldValue_tenantId_fieldId_scope_type_fkey" FOREIGN KEY ("tenantId", "fieldId", "scope", "type") REFERENCES "CustomFieldDefinition"("tenantId", "id", "scope", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateProjectFieldValue" ADD CONSTRAINT "RealEstateProjectFieldValue_tenantId_fieldId_optionId_fkey" FOREIGN KEY ("tenantId", "fieldId", "optionId") REFERENCES "CustomFieldOption"("tenantId", "fieldId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Match the existing tenant RLS contract.
ALTER TABLE "CustomFieldDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldDefinition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomFieldDefinition" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CustomFieldOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomFieldOption" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmEnquiryFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmEnquiryFieldValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmEnquiryFieldValue" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CrmOpportunityFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CrmOpportunityFieldValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CrmOpportunityFieldValue" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "RealEstateProjectFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RealEstateProjectFieldValue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RealEstateProjectFieldValue" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_valid" CHECK (
 scope IN ('ENQUIRY','OPPORTUNITY','SALES','PROJECT') AND type IN ('TEXT','NUMBER','DATE','BOOLEAN','SELECT')
 AND visibility IN ('ALL','MANAGERS') AND editability IN ('ALL','MANAGERS')
 AND char_length(name) BETWEEN 1 AND 100 AND code ~ '^[a-z][a-z0-9_]{0,49}$'
 AND char_length("helpText") <= 500 AND "maxLength" BETWEEN 1 AND 2000
 AND position BETWEEN 0 AND 1000000 AND version > 0 AND (minimum IS NULL OR maximum IS NULL OR minimum <= maximum)
 AND (NOT required OR "requiredSince" IS NOT NULL));
ALTER TABLE "CustomFieldOption" ADD CONSTRAINT "CustomFieldOption_valid" CHECK (char_length(name) BETWEEN 1 AND 100 AND position BETWEEN 0 AND 50);
ALTER TABLE "CrmEnquiryFieldValue" ADD CONSTRAINT "CrmEnquiryFieldValue_typed" CHECK (
 scope IN ('ENQUIRY','SALES') AND num_nonnulls("textValue","numberValue","dateValue","booleanValue","optionId") = 1
 AND ((type='TEXT' AND "textValue" IS NOT NULL AND char_length("textValue") <= 2000 AND "textKey" IS NOT NULL AND "textKey" ~ '^[a-f0-9]{64}$')
 OR (type='NUMBER' AND "numberValue" IS NOT NULL) OR (type='DATE' AND "dateValue" IS NOT NULL)
 OR (type='BOOLEAN' AND "booleanValue" IS NOT NULL) OR (type='SELECT' AND "optionId" IS NOT NULL))
 AND (type='TEXT' OR "textKey" IS NULL) AND char_length("fieldName") BETWEEN 1 AND 100);
ALTER TABLE "CrmOpportunityFieldValue" ADD CONSTRAINT "CrmOpportunityFieldValue_typed" CHECK (
 scope IN ('OPPORTUNITY','SALES') AND num_nonnulls("textValue","numberValue","dateValue","booleanValue","optionId") = 1
 AND ((type='TEXT' AND "textValue" IS NOT NULL AND char_length("textValue") <= 2000 AND "textKey" IS NOT NULL AND "textKey" ~ '^[a-f0-9]{64}$')
 OR (type='NUMBER' AND "numberValue" IS NOT NULL) OR (type='DATE' AND "dateValue" IS NOT NULL)
 OR (type='BOOLEAN' AND "booleanValue" IS NOT NULL) OR (type='SELECT' AND "optionId" IS NOT NULL))
 AND (type='TEXT' OR "textKey" IS NULL) AND char_length("fieldName") BETWEEN 1 AND 100);
ALTER TABLE "RealEstateProjectFieldValue" ADD CONSTRAINT "RealEstateProjectFieldValue_typed" CHECK (
 scope IN ('PROJECT') AND num_nonnulls("textValue","numberValue","dateValue","booleanValue","optionId") = 1
 AND ((type='TEXT' AND "textValue" IS NOT NULL AND char_length("textValue") <= 2000 AND "textKey" IS NOT NULL AND "textKey" ~ '^[a-f0-9]{64}$')
 OR (type='NUMBER' AND "numberValue" IS NOT NULL) OR (type='DATE' AND "dateValue" IS NOT NULL)
 OR (type='BOOLEAN' AND "booleanValue" IS NOT NULL) OR (type='SELECT' AND "optionId" IS NOT NULL))
 AND (type='TEXT' OR "textKey" IS NULL) AND char_length("fieldName") BETWEEN 1 AND 100);
COMMIT;
