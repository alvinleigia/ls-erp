BEGIN;

ALTER TABLE "CrmSalesTeam" ALTER COLUMN "workflow" SET DEFAULT 'BOTH';
ALTER TABLE "CrmSalesTeam" DROP CONSTRAINT "CrmSalesTeam_valid";
ALTER TABLE "CrmSalesTeam" ADD CONSTRAINT "CrmSalesTeam_valid" CHECK (
  workflow IN ('BOTH','ENQUIRY_FIRST','DIRECT') AND version > 0
  AND char_length(name) BETWEEN 1 AND 100 AND "nameKey"=lower(name)
);

-- Existing teams retain their workflow, version, membership and sales records.
COMMIT;
