/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic data only. Never reads .env or accepts a hosted database.
const { Client } = require("pg")
const { randomUUID } = require("crypto")
const assert = require("node:assert/strict")
async function main() {
  const url = new URL(process.env.CRM_TEST_DATABASE_URL || "http://invalid")
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw new Error("Use the isolated local CRM test database.")
  const id = `activity_perf_${randomUUID()}`
  const root = new Client({ connectionString: url.toString() })
  url.username = "crm_test_runtime"; url.password = ""
  const runtime = new Client({ connectionString: url.toString() })
  await root.connect(); await runtime.connect()
  try {
    await root.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,now())', [id])
    await root.query('INSERT INTO "User" (id,"tenantId",name,email,role,"updatedAt") VALUES ($1,$1,$1,$2,\'ADMIN\',now())', [id, `${id}@example.test`])
    await root.query('INSERT INTO "CrmContact" (id,"tenantId",name,"ownerUserId","updatedAt") VALUES ($1,$1,$1,$1,now())', [id])
    await root.query('INSERT INTO "CrmActivityType" (id,"tenantId",name,"nameKey","baseType","updatedAt") VALUES ($1,$1,\'Site Visit\',\'site visit\',\'MEETING\',now())', [id])
    await root.query(`INSERT INTO "CrmTask" (id,"tenantId","contactId","assignedUserId",title,type,"activityTypeId","activityTypeName",status,"dueOn","completedAt","updatedAt")
      SELECT $1 || '_' || n, $1,$1,$1,'Synthetic activity','MEETING',CASE WHEN n % 100=0 THEN $1 ELSE NULL END,CASE WHEN n % 100=0 THEN 'Site Visit' ELSE NULL END,
        CASE WHEN n % 3=0 THEN 'COMPLETED'::"CrmWorkStatus" ELSE 'OPEN'::"CrmWorkStatus" END,
        DATE '2026-10-01' + (n % 60), CASE WHEN n % 3=0 THEN TIMESTAMP '2026-09-28' ELSE NULL END,now()
      FROM generate_series(1,20000) AS n`, [id])
    await root.query('ANALYZE "CrmTask"')
    await runtime.query("SELECT set_config('app.tenant_id',$1,false), set_config('app.rls_bypass','off',false)", [id])
    const queries = {
      list: `SELECT id,title FROM "CrmTask" WHERE "tenantId"=$1 AND "activityTypeId"=$1 AND status IN ('OPEN','IN_PROGRESS') ORDER BY "dueOn","startsAt",id LIMIT 20`,
      completedReport: `SELECT type,count(*) FROM "CrmTask" WHERE "tenantId"=$1 AND "activityTypeId"=$1 AND status='COMPLETED' AND "completedAt">=DATE '2026-09-01' AND "completedAt"<DATE '2026-10-01' GROUP BY type`,
    }
    for (const [name, sql] of Object.entries(queries)) {
      const result = await runtime.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, [id])
      const plan = result.rows[0]["QUERY PLAN"][0]
      assert.match(JSON.stringify(plan), /CrmTask_tenantId_activityTypeId_(status_dueOn|completedAt)_idx/)
      console.log(JSON.stringify({ query: name, syntheticRows: 20000, executionMs: plan["Execution Time"], indexed: true }))
    }
  } finally { await runtime.end(); await root.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
