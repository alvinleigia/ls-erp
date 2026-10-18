/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic records inserted BEFORE their historical migration, never into a
// current/client database. The isolated Docker runner owns the empty database.
const fs = require("node:fs")
const assert = require("node:assert/strict")
const { Client } = require("pg")

async function identity(db, tenantId, userId, contactId) {
  await db.query('INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ($1,$1,$1,now())', [tenantId])
  await db.query('INSERT INTO "User" (id,"tenantId",name,email,role,"updatedAt") VALUES ($1,$2,$1,$3,\'ADMIN\',now())', [userId, tenantId, `${userId}@example.test`])
  await db.query('INSERT INTO "CrmContact" (id,"tenantId",name,"ownerUserId","updatedAt") VALUES ($1,$2,$1,$3,now())', [contactId, tenantId, userId])
}
async function lead(db, id, tenantId, userId, contactId, source = null) {
  await db.query(`INSERT INTO "CrmEnquiry" (id,"tenantId","contactId",title,"assignedUserId",source,version,"createdAt","updatedAt")
    VALUES ($1,$2,$3,$1,$4,$5,4,'2026-01-01','2026-02-01')`, [id, tenantId, contactId, userId, source])
}
const before = {
  async "20260924090000_crm_activity_workspace"(db) {
    await identity(db, "crm_upgrade", "crm_upgrade_user", "crm_upgrade_contact")
    await lead(db, "crm_upgrade_lead", "crm_upgrade", "crm_upgrade_user", "crm_upgrade_contact")
    await db.query(`INSERT INTO "CrmTask" (id,"tenantId","enquiryId",title,"dueOn","completedAt") VALUES
      ('crm_upgrade_open','crm_upgrade','crm_upgrade_lead','Open follow-up','2026-09-25',NULL),
      ('crm_upgrade_done','crm_upgrade','crm_upgrade_lead','Completed follow-up','2026-09-20','2026-09-21T10:00:00Z')`)
  },
  async "20260928120000_crm_lead_intake"(db) {
    for (const suffix of ["a", "b"]) await identity(db, `intake_upgrade_${suffix}`, `intake_user_${suffix}`, `intake_contact_${suffix}`)
    for (const [id, suffix, source] of [["intake_lead_a1", "a", "  Web   Site  "], ["intake_lead_a2", "a", "web site"], ["intake_lead_a3", "a", ""], ["intake_lead_b1", "b", "WEB SITE"]]) {
      await lead(db, id, `intake_upgrade_${suffix}`, `intake_user_${suffix}`, `intake_contact_${suffix}`, source)
    }
    await db.query(`INSERT INTO "CrmPipeline" (id,"tenantId",name,"updatedAt") VALUES ('intake_pipeline','intake_upgrade_a','Sales',now());
      INSERT INTO "CrmStage" (id,"tenantId","pipelineId",name,probability,color,position) VALUES ('intake_stage','intake_upgrade_a','intake_pipeline','Qualified',20,'#123456',0);
      INSERT INTO "CrmOpportunity" (id,"tenantId",title,"pipelineId","stageId","contactId","enquiryId","assignedUserId",amount,currency,probability,"expectedCloseOn","createdAt","updatedAt")
      VALUES ('intake_deal','intake_upgrade_a','Existing deal','intake_pipeline','intake_stage','intake_contact_a','intake_lead_a1','intake_user_a',100,'INR',20,'2026-12-01','2026-01-01','2026-02-01')`)
  },
  async "20260929090000_real_estate_choices"(db) {
    await db.query(`INSERT INTO "RealEstateProject" (id,"tenantId",name,code,categories,lifecycle,version,"createdAt","updatedAt")
      VALUES ('choice_upgrade_parent','intake_upgrade_a','Existing project','UPGRADE-P',ARRAY['APARTMENT','VILLA'],'SELLING',7,'2026-01-01','2026-02-01');
      INSERT INTO "RealEstateProject" (id,"tenantId","parentId",name,code,categories,lifecycle,version,"createdAt","updatedAt")
      VALUES ('choice_upgrade_child','intake_upgrade_a','choice_upgrade_parent','Existing phase','UPGRADE-C',ARRAY['APARTMENT'],'ON_HOLD',3,'2026-01-01','2026-02-01');
      INSERT INTO "RealEstateProjectMember" ("tenantId","projectId","userId") VALUES ('intake_upgrade_a','choice_upgrade_parent','intake_user_a');
      INSERT INTO "RealEstateEnquiryContext" ("tenantId","enquiryId","projectId","subprojectId","budgetMin","budgetCurrency","propertyCategory","buyingTimeframe")
      VALUES ('intake_upgrade_a','intake_lead_a1','choice_upgrade_parent','choice_upgrade_child',100.125,'INR','APARTMENT','WITHIN_3_MONTHS');
      INSERT INTO "RealEstateOpportunityContext" ("tenantId","opportunityId","projectId","subprojectId","budgetMin","budgetCurrency","propertyCategory","buyingTimeframe")
      VALUES ('intake_upgrade_a','intake_deal','choice_upgrade_parent','choice_upgrade_child',100.125,'INR','APARTMENT','WITHIN_3_MONTHS')`)
  },
}

async function main() {
  // The runner is only usable inside its named, fresh, internal-network container.
  assert.equal(process.env.R5_HISTORICAL_CONTAINER, "1")
  const url = new URL(process.env.CRM_TEST_DATABASE_URL)
  assert.equal(url.hostname, "127.0.0.1")
  assert.equal(url.port, "5432")
  assert.equal(url.pathname, "/ls_salon_crm_test")
  const db = new Client({ connectionString: url.toString() })
  await db.connect()
  try {
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, "Requires an empty database")
    const migrations = require("../../docs/industry-release-manifest.json").migrations
    const seeded = []
    for (const migration of migrations) {
      if (before[migration.name]) { await before[migration.name](db); seeded.push(migration.name) }
      try { await db.query(fs.readFileSync(`prisma/migrations/${migration.name}/migration.sql`, "utf8")) }
      catch (error) { throw new Error(`${migration.name}: ${error.code}`, { cause: error }) }
    }
    assert.equal(seeded.length, 3)
    await db.query(`CREATE ROLE crm_test_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public,app TO crm_test_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO crm_test_runtime;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_test_runtime`)
    console.log(JSON.stringify({ migrations: migrations.length, seededBefore: seeded, historicalChecksEnabled: 4 }))
  } finally { await db.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
