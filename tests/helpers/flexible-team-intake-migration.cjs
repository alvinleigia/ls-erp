/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), { Client } = require('pg'), { createHash } = require('node:crypto')
async function main() {
  assert.equal(process.env.R5_HISTORICAL_CONTAINER, '1')
  const url = new URL(process.env.CRM_TEST_DATABASE_URL)
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/ls_salon_crm_test')
  const db = new Client({ connectionString: url.toString() }); await db.connect()
  try {
    const tenant = 'flexible_migration_fixture'
    await db.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())', [tenant])
    for (const workflow of ['ENQUIRY_FIRST', 'DIRECT']) await db.query('INSERT INTO "CrmSalesTeam"("tenantId",id,name,"nameKey",workflow,version,"updatedAt") VALUES($1,$2,$2,lower($2),$3,4,now())', [tenant, workflow, workflow])
    const names = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r => r.tablename)
    const snapshot = async () => Promise.all(names.map(async name => (await db.query(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows))
    const before = await snapshot(), name = '20261024000100_flexible_team_intake', sql = fs.readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
    await db.query(sql); assert.deepEqual(await snapshot(), before)
    const result = await db.query('INSERT INTO "CrmSalesTeam"("tenantId",id,name,"nameKey","updatedAt") VALUES($1,\'both_default\',\'Both default\',\'both default\',now()) RETURNING workflow', [tenant])
    assert.equal(result.rows[0].workflow, 'BOTH')
    await assert.rejects(db.query('UPDATE "CrmSalesTeam" SET workflow=\'UNKNOWN\' WHERE "tenantId"=$1', [tenant]), { code: '23514' })
    await db.query('DELETE FROM "CrmSalesTeam" WHERE "tenantId"=$1', [tenant])
    await db.query('INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())', [name, createHash('sha256').update(sql).digest('hex')])
    assert.equal((await db.query('SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].n, 107)
    console.log(`Flexible intake preserves all ${names.length} business tables and existing rules; new teams default to BOTH; 107 migrations.`)
  } finally { await db.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
