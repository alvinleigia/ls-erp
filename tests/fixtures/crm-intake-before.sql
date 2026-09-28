-- Synthetic upgrade fixture for the schema immediately before lead intake.
INSERT INTO "Tenant" (id, slug, name, "updatedAt") VALUES
('intake_upgrade_a', 'intake-upgrade-a', 'Intake upgrade A', CURRENT_TIMESTAMP),
('intake_upgrade_b', 'intake-upgrade-b', 'Intake upgrade B', CURRENT_TIMESTAMP);
INSERT INTO "User" (id, "tenantId", name, email, role, "updatedAt") VALUES
('intake_owner_a', 'intake_upgrade_a', 'Upgrade A', 'upgrade-a@example.test', 'ADMIN', CURRENT_TIMESTAMP),
('intake_owner_b', 'intake_upgrade_b', 'Upgrade B', 'upgrade-b@example.test', 'ADMIN', CURRENT_TIMESTAMP);
INSERT INTO "CrmContact" (id, "tenantId", name, "ownerUserId", "updatedAt") VALUES
('intake_contact_a', 'intake_upgrade_a', 'Synthetic buyer A', 'intake_owner_a', CURRENT_TIMESTAMP),
('intake_contact_b', 'intake_upgrade_b', 'Synthetic buyer B', 'intake_owner_b', CURRENT_TIMESTAMP);
INSERT INTO "CrmEnquiry" (id, "tenantId", "contactId", title, source, "assignedUserId", version, "createdAt", "updatedAt") VALUES
('intake_lead_a1', 'intake_upgrade_a', 'intake_contact_a', 'Legacy one', '  Web   Site  ', 'intake_owner_a', 4, '2026-01-01', '2026-02-01'),
('intake_lead_a2', 'intake_upgrade_a', 'intake_contact_a', 'Legacy two', 'web site', 'intake_owner_a', 2, '2026-01-02', '2026-02-02'),
('intake_lead_a3', 'intake_upgrade_a', 'intake_contact_a', 'No source', NULL, 'intake_owner_a', 1, '2026-01-03', '2026-02-03'),
('intake_lead_b1', 'intake_upgrade_b', 'intake_contact_b', 'Other tenant', 'Web Site', 'intake_owner_b', 1, '2026-01-04', '2026-02-04');
INSERT INTO "CrmPipeline" (id, "tenantId", name, "updatedAt") VALUES ('intake_pipeline', 'intake_upgrade_a', 'Upgrade pipeline', CURRENT_TIMESTAMP);
INSERT INTO "CrmStage" (id, "tenantId", "pipelineId", name, kind, probability, color, position) VALUES
('intake_stage', 'intake_upgrade_a', 'intake_pipeline', 'Open', 'OPEN', 20, '#123456', 0);
INSERT INTO "CrmOpportunity" (id, "tenantId", title, "pipelineId", "stageId", "contactId", "enquiryId", "assignedUserId", amount, currency, probability, "expectedCloseOn", "updatedAt") VALUES
('intake_deal', 'intake_upgrade_a', 'Already converted', 'intake_pipeline', 'intake_stage', 'intake_contact_a', 'intake_lead_a1', 'intake_owner_a', 100, 'INR', 20, '2026-12-01', '2026-02-01');
