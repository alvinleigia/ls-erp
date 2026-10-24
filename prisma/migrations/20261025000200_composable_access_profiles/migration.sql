BEGIN;
CREATE TABLE "TenantUserAccess" (
 "tenantId" text NOT NULL, "userId" text NOT NULL,
 "salesRecordScope" text NOT NULL DEFAULT 'OWN', "projectRecordScope" text NOT NULL DEFAULT 'OWN',
 version integer NOT NULL DEFAULT 1, "updatedAt" timestamp(3) NOT NULL,
 CONSTRAINT "TenantUserAccess_pkey" PRIMARY KEY ("tenantId","userId"),
 CONSTRAINT "TenantUserAccess_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TenantUserAccess_valid" CHECK (version>0 AND "salesRecordScope" IN ('ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL') AND "projectRecordScope" IN ('ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL'))
);
ALTER TABLE "TenantUserAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantUserAccess" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantUserAccess" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
-- Preserve the former single role's visibility, independently of future profiles.
INSERT INTO "TenantUserAccess"("tenantId","userId","salesRecordScope","projectRecordScope","updatedAt")
 SELECT u."tenantId",u.id,COALESCE(r."salesRecordScope",'ACCOUNT_ROLE'),COALESCE(r."projectRecordScope",'ACCOUNT_ROLE'),now()
 FROM "User" u LEFT JOIN "TenantRoleAssignment" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id
 LEFT JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId"
 WHERE u."tenantId" IS NOT NULL AND u.role IN ('STAFF','MANAGER');
ALTER TABLE "TenantRoleAssignment" DROP CONSTRAINT "TenantRoleAssignment_pkey";
ALTER TABLE "TenantRoleAssignment" ADD CONSTRAINT "TenantRoleAssignment_pkey" PRIMARY KEY ("tenantId","userId","roleId");
ALTER TABLE "TenantAccessRole" ADD COLUMN "moduleKey" text NOT NULL DEFAULT 'all';
-- Freeze today's account permissions for existing unassigned users. Future
-- modules are absent from this explicit grant; no runtime allow-all fallback.
INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt")
 SELECT 'account_access_109_'||md5(u."tenantId"),u."tenantId",'Account access '||substr(md5(u."tenantId"),1,12),lower('Account access '||substr(md5(u."tenantId"),1,12)),ARRAY['receivables.read','receivables.create','orderPayments.read','orderPayments.create','orderPayments.cancel','unitReservations.read','unitReservations.create','unitReservations.confirm','unitReservations.cancel','salesOrders.read','salesOrders.create','salesOrders.confirm','salesOrders.cancel','catalogItems.read','catalogItems.create','catalogItems.edit','catalogItems.archive','dashboard.read','auditLogs.read','users.read','businessSettings.read','businessSettings.edit','taxRates.read','taxRates.create','taxRates.edit','taxRates.archive','leaveRequests.read','leaveRequests.create','leaveRequests.archive','leaveApprovals.read','leaveApprovals.approve','leaveApprovals.archive','leaveDefinitions.read','leaveDefinitions.create','leaveDefinitions.edit','leaveDefinitions.archive','leaveGroups.read','leaveGroups.create','leaveGroups.edit','leaveGroups.archive','shiftTemplates.read','shiftTemplates.create','shiftTemplates.edit','shiftTemplates.archive','shiftSchedules.read','shiftSchedules.create','shiftSchedules.edit','shiftSchedules.archive','shiftPlans.read','shiftPlans.create','shiftPlans.edit','shiftPlans.archive','shiftRoster.read','shiftRoster.edit','shiftRoster.archive','appointments.read','appointments.create','appointments.edit','appointments.archive','appointments.export','appointmentCoupons.read','appointmentCoupons.create','appointmentCoupons.edit','appointmentCoupons.archive','services.read','services.create','services.edit','services.archive','serviceCategories.read','serviceCategories.create','serviceCategories.edit','serviceCategories.archive','inventoryProducts.read','inventoryProducts.create','inventoryProducts.edit','inventoryProducts.archive','inventoryCategories.read','inventoryCategories.create','inventoryCategories.edit','inventoryCategories.archive','inventorySuppliers.read','inventorySuppliers.create','inventorySuppliers.edit','inventorySuppliers.archive','inventoryPurchases.read','inventoryPurchases.create','inventoryPurchases.edit','contacts.read','contacts.create','contacts.edit','contacts.archive','accounts.read','accounts.create','accounts.edit','accounts.archive','enquiries.read','enquiries.create','enquiries.edit','enquiries.export','enquiries.assign','opportunities.read','opportunities.create','opportunities.edit','opportunities.export','opportunities.assign','activities.read','activities.create','activities.edit','activities.archive','activities.export','activities.assign','reports.read','reports.export','pipelines.read','pipelines.create','pipelines.edit','pipelines.archive','leadSources.read','leadSources.create','leadSources.edit','leadSources.archive','lostReasons.read','lostReasons.create','lostReasons.edit','lostReasons.archive','activityTypes.read','activityTypes.create','activityTypes.edit','activityTypes.archive','activityPlans.read','activityPlans.create','activityPlans.edit','activityPlans.archive','followUpRules.read','followUpRules.create','followUpRules.edit','followUpRules.archive','teams.read','teams.create','teams.edit','teams.archive','teams.assign','customFields.read','customFields.create','customFields.edit','customFields.archive','projects.read','projects.create','projects.edit','projects.archive','projects.export','projects.assign','projectSettings.read','projectSettings.create','projectSettings.edit','projectSettings.archive','quotations.read','quotations.create','quotations.edit','quotations.export','quotationTemplates.read','quotationTemplates.create','quotationTemplates.edit','quotationTemplates.archive']::text[],now()
 FROM "User" u WHERE u.role IN ('STAFF','MANAGER') AND u."tenantId" IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM "TenantRoleAssignment" a WHERE a."tenantId"=u."tenantId" AND a."userId"=u.id)
 GROUP BY u."tenantId";
INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt")
 SELECT u."tenantId",u.id,'account_access_109_'||md5(u."tenantId"),now() FROM "User" u
 WHERE u.role IN ('STAFF','MANAGER') AND u."tenantId" IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM "TenantRoleAssignment" a WHERE a."tenantId"=u."tenantId" AND a."userId"=u.id);
ALTER TABLE "TenantAccessRole" DROP COLUMN "salesRecordScope", DROP COLUMN "projectRecordScope";
-- Preserve existing runtime table privileges for the new policy table.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee,privilege_type FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='TenantRoleAssignment' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
 LOOP IF r.grantee='PUBLIC' THEN EXECUTE format('GRANT %s ON "TenantUserAccess" TO PUBLIC',r.privilege_type);
 ELSE EXECUTE format('GRANT %s ON "TenantUserAccess" TO %I',r.privilege_type,r.grantee); END IF; END LOOP;
END $$;
COMMIT;
