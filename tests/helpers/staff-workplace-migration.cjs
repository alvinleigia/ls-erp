/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const employee=(await db.query('SELECT s.id,u."tenantId" FROM "StaffProfile" s JOIN "User" u ON u.id=s."userId" LIMIT 1')).rows[0]
  assert(employee)
  await db.query('INSERT INTO "ShiftSchedule"(id,"tenantId",name,"startDate","weekOffDay1","weekOff2Weeks","updatedAt") VALUES(\'workplace_upgrade_schedule\',$1,\'Existing default\',\'2020-01-01\',\'SUNDAY\',ARRAY[]::integer[],now())',[employee.tenantId])
  await db.query('INSERT INTO "StaffScheduleAssignment"(id,"staffProfileId","scheduleId","startDate","updatedAt") VALUES(\'workplace_upgrade_assignment\',$1,\'workplace_upgrade_schedule\',\'2020-01-01\',now())',[employee.id])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  const capture=async()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(row=>row.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const before=await capture(),oldPolicies=await policies(),name='20261026000800_staff_workplaces',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies)
  assert.equal((await db.query("SELECT to_regclass('public.\"StaffWorkplaceAssignment\"') f")).rows[0].f,null)
  await db.query(sql);assert.deepEqual(await capture(),before)
  const allPolicies=await policies();for(const policy of oldPolicies)assert.deepEqual(allPolicies.find(p=>p.tablename===policy.tablename&&p.policyname===policy.policyname),policy)
  const counts=(await db.query('SELECT (SELECT count(*)::int FROM "StaffProfile") staff,(SELECT count(*)::int FROM "StaffWorkplacePolicy") policies,(SELECT count(*)::int FROM "StaffWorkplaceAssignment") placements')).rows[0];assert(counts.staff>0);assert.equal(counts.staff,counts.policies);assert.equal(counts.staff,counts.placements)
  assert.equal((await db.query('SELECT count(*)::int n FROM "StaffWorkplaceAssignment" a JOIN "StaffWorkplacePolicy" p USING("tenantId","staffProfileId") JOIN "BusinessOffice" o ON o.id=a."officeId" AND o."tenantId"=a."tenantId" WHERE p.version<>1 OR NOT o."isInitial" OR a."startDate" IS NOT NULL OR a."endDate" IS NOT NULL OR a."canceledAt" IS NOT NULL')).rows[0].n,0)
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_class WHERE relname IN ('StaffWorkplacePolicy','StaffWorkplaceAssignment') AND relrowsecurity AND relforcerowsecurity")).rows[0].n,2)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Staff workplaces: rollback and policy restoration verified; all ${tables.length} preceding tables preserved exactly; ${counts.staff} profiles placed once in their initial office, without changing grants or recording invented start dates.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
