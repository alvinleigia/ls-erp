BEGIN;

-- Preserve team IDs, links, RLS, grants and membership in place.
ALTER TABLE "CrmSalesTeam" RENAME TO "BusinessTeam";
ALTER TABLE "CrmSalesTeamMember" RENAME TO "BusinessTeamMember";
DO $$
DECLARE r record; new_name text;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
    WHERE connamespace='public'::regnamespace AND conname LIKE 'CrmSalesTeam%'
  LOOP
    new_name := replace(replace(r.conname, 'CrmSalesTeamMember', 'BusinessTeamMember'), 'CrmSalesTeam', 'BusinessTeam');
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, new_name);
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'CrmSalesTeam%'
  LOOP
    new_name := replace(replace(r.indexname, 'CrmSalesTeamMember', 'BusinessTeamMember'), 'CrmSalesTeam', 'BusinessTeam');
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, new_name);
  END LOOP;
END $$;

ALTER TABLE "TenantAccessRole" RENAME COLUMN "crmRecordScope" TO "salesRecordScope";
ALTER TABLE "TenantAccessRole" RENAME CONSTRAINT "TenantAccessRole_crmRecordScope_check" TO "TenantAccessRole_salesRecordScope_check";
ALTER TABLE "TenantAccessRole" ADD COLUMN "projectRecordScope" text NOT NULL DEFAULT 'ACCOUNT_ROLE';
ALTER TABLE "TenantAccessRole" ADD CONSTRAINT "TenantAccessRole_projectRecordScope_check"
  CHECK ("projectRecordScope" IN ('ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL'));
UPDATE "TenantAccessRole" r SET permissions=ARRAY(
  SELECT CASE WHEN p LIKE 'salesTeams.%' THEN replace(p,'salesTeams.','teams.') ELSE p END
  FROM unnest(r.permissions) p);

ALTER TABLE "RealEstateProject" ADD COLUMN "teamId" text;
CREATE INDEX "RealEstateProject_tenantId_teamId_idx" ON "RealEstateProject"("tenantId","teamId");
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_tenantId_teamId_fkey"
  FOREIGN KEY ("tenantId","teamId") REFERENCES "BusinessTeam"("tenantId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
-- Subprojects inherit their parent's assignment; never maintain two competing teams.
ALTER TABLE "RealEstateProject" ADD CONSTRAINT "RealEstateProject_team_parent_check"
  CHECK ("parentId" IS NULL OR "teamId" IS NULL);

COMMIT;
