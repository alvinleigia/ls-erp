-- Applied after crm-intake-before.sql, on a disposable pre-choice schema only.
INSERT INTO "RealEstateProject" (id,"tenantId",name,code,lifecycle,categories,version,"createdAt","updatedAt") VALUES
('choice_upgrade_parent','intake_upgrade_a','Legacy project','LEGACY','SELLING',ARRAY['APARTMENT','VILLA'],7,'2026-01-01','2026-02-01');
INSERT INTO "RealEstateProject" (id,"tenantId","parentId",name,code,lifecycle,categories,version,"createdAt","updatedAt") VALUES
('choice_upgrade_child','intake_upgrade_a','choice_upgrade_parent','Legacy child','LEGACY-1','ON_HOLD',ARRAY['PLOT'],3,'2026-01-02','2026-02-02');
INSERT INTO "RealEstateProjectMember" ("tenantId","projectId","userId") VALUES ('intake_upgrade_a','choice_upgrade_parent','intake_owner_a');
INSERT INTO "RealEstateEnquiryContext" ("tenantId","enquiryId","projectId","subprojectId","propertyCategory","buyingTimeframe","budgetMin","budgetCurrency") VALUES
('intake_upgrade_a','intake_lead_a1','choice_upgrade_parent','choice_upgrade_child','APARTMENT','WITHIN_3_MONTHS',100.125,'INR');
INSERT INTO "RealEstateOpportunityContext" ("tenantId","opportunityId","projectId","subprojectId","propertyCategory","buyingTimeframe","budgetMin","budgetCurrency") VALUES
('intake_upgrade_a','intake_deal','choice_upgrade_parent','choice_upgrade_child','APARTMENT','WITHIN_3_MONTHS',100.125,'INR');
