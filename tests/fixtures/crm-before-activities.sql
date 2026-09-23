-- Synthetic upgrade fixture: apply only in the guarded disposable test database.
INSERT INTO "Tenant" (id, slug, name, "updatedAt") VALUES ('crm_upgrade', 'crm-upgrade', 'Upgrade fixture', NOW());
INSERT INTO "User" (id, "tenantId", name, email, role, "updatedAt") VALUES ('crm_upgrade_user', 'crm_upgrade', 'Upgrade staff', 'upgrade@example.test', 'STAFF', NOW());
INSERT INTO "CrmContact" (id, "tenantId", name, "ownerUserId", "updatedAt") VALUES ('crm_upgrade_contact', 'crm_upgrade', 'Upgrade contact', 'crm_upgrade_user', NOW());
INSERT INTO "CrmEnquiry" (id, "tenantId", "contactId", title, "assignedUserId", "updatedAt") VALUES ('crm_upgrade_enquiry', 'crm_upgrade', 'crm_upgrade_contact', 'Upgrade enquiry', 'crm_upgrade_user', NOW());
INSERT INTO "CrmTask" (id, "tenantId", "enquiryId", title, "dueOn", "completedAt", "createdAt") VALUES
('crm_upgrade_open', 'crm_upgrade', 'crm_upgrade_enquiry', 'Preserve open task', '2026-09-25', NULL, '2026-09-20T10:00:00Z'),
('crm_upgrade_done', 'crm_upgrade', 'crm_upgrade_enquiry', 'Preserve completed task', '2026-09-21', '2026-09-21T10:00:00Z', '2026-09-20T10:00:00Z');
