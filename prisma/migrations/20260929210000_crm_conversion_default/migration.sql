ALTER TABLE "CrmStage" ADD COLUMN "isConversionDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CrmStage" ADD CONSTRAINT "CrmStage_conversion_default_open_check"
  CHECK (NOT "isConversionDefault" OR (NOT "archived" AND "kind" = 'OPEN'));

CREATE UNIQUE INDEX "CrmStage_one_conversion_default"
  ON "CrmStage" ("tenantId", "pipelineId") WHERE "isConversionDefault";
