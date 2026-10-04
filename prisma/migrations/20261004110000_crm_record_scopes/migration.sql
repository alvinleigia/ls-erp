-- Existing roles and memberships retain their previous access.
ALTER TABLE "TenantAccessRole" ADD COLUMN "crmRecordScope" TEXT NOT NULL DEFAULT 'ACCOUNT_ROLE';
ALTER TABLE "TenantAccessRole" ADD CONSTRAINT "TenantAccessRole_crmRecordScope_check" CHECK ("crmRecordScope" IN ('ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL'));
ALTER TABLE "CrmSalesTeamMember" ADD COLUMN "isManager" BOOLEAN NOT NULL DEFAULT false;
