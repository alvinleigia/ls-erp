/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const person=(await db.query('SELECT p.id,u."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" ORDER BY p.id LIMIT 1')).rows[0];assert.ok(person)
  await db.query('INSERT INTO "ShiftTemplate"(id,"tenantId",name,"startTime","endTime","createdAt","updatedAt") VALUES(\'migration_daily_template\',$1,\'Preserved daily name\',\'08:00\',\'16:00\',\'2020-01-01\',\'2020-01-02\')',[person.tenantId])
  await db.query('INSERT INTO "StaffShiftOverride"(id,"staffProfileId",date,"templateId","createdAt","updatedAt") VALUES(\'migration_daily_override\',$1,\'2020-01-06\',\'migration_daily_template\',\'2020-01-01\',\'2020-01-02\'),(\'migration_daily_off\',$1,\'2020-01-07\',NULL,\'2020-01-01\',\'2020-01-02\')',[person.id])
  await db.query('INSERT INTO "StaffFlexibleAvailability"(id,"staffProfileId",date,"startTime","endTime","sortOrder","createdAt","updatedAt") VALUES(\'migration_daily_slot\',$1,\'2020-01-06\',\'09:00\',\'17:00\',4,\'2020-01-01\',\'2020-01-02\')',[person.id])
  await db.query('INSERT INTO "AuditLog"(id,"tenantId",event,"entityType",before,after) SELECT \'migration_daily_audit\',$1,\'workforce.shiftRoster.edit\',\'shiftRoster\',\'[]\'::jsonb,jsonb_agg(to_jsonb(r)) FROM "StaffShiftOverride" r WHERE r.id LIKE \'migration_daily_%\'',[person.tenantId])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const capture=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const functions=async()=>(await db.query("SELECT proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND proname IN ('history_flexible_slots','sync_roster_history','effective_working_time') ORDER BY proname")).rows
  const before=await capture(),oldPolicies=await policies(),oldFunctions=await functions(),name='20261026001300_daily_roster_offices',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0;COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies);assert.deepEqual(await functions(),oldFunctions)
  await db.query(sql)
  const offices=new Map((await db.query('SELECT "tenantId",id FROM "BusinessOffice" WHERE "isInitial"')).rows.map(r=>[r.tenantId,r.id]))
  const after=await capture(),expected=structuredClone(before),users=new Map(before[tables.indexOf('User')].map(r=>[r.id,r.tenantId])),profiles=new Map(before[tables.indexOf('StaffProfile')].map(r=>[r.id,users.get(r.userId)]))
  for(const tbl of ['StaffShiftOverride','StaffFlexibleAvailability'])for(const row of expected[tables.indexOf(tbl)]){row.tenantId=profiles.get(row.staffProfileId);row.officeId=offices.get(row.tenantId)}
  for(const row of expected[tables.indexOf('AuditLog')])if(row.entityType==='shiftRoster'&&[...(Array.isArray(row.before)?row.before:[]),...(Array.isArray(row.after)?row.after:[])].some(x=>Object.hasOwn(x,'date')&&Object.hasOwn(x,'staffProfileId')))row.metadata={...row.metadata,officeId:offices.get(row.tenantId),officeFamily:'dailyRoster'}
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;const normalized=rows=>rows.map(x=>JSON.stringify(stable(x))).sort();for(let i=0;i<tables.length;i++)assert.deepEqual(normalized(after[i]),normalized(expected[i]),tables[i])
  const allPolicies=await policies();for(const p of oldPolicies)assert.deepEqual(allPolicies.find(r=>r.tablename===p.tablename&&r.policyname===p.policyname),p)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  if(process.env.R10_DAILY_FIXTURES==='1')await db.query(`CREATE FUNCTION app.test_daily_office_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW."tenantId" IS NULL THEN SELECT u."tenantId" INTO NEW."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE p.id=NEW."staffProfileId";END IF;
   IF NEW."officeId" IS NULL THEN SELECT id INTO NEW."officeId" FROM "BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND "isInitial";END IF;RETURN NEW;
  END $$;CREATE TRIGGER aaa_test_daily_office_fixture BEFORE INSERT ON "StaffShiftOverride" FOR EACH ROW EXECUTE FUNCTION app.test_daily_office_fixture();CREATE TRIGGER aaa_test_daily_office_fixture BEFORE INSERT ON "StaffFlexibleAvailability" FOR EACH ROW EXECUTE FUNCTION app.test_daily_office_fixture();`)
  console.log(`Daily roster offices: forced rollback, source functions and prior policies verified; ${tables.length} prior tables preserved except explicit root/audit ownership; IDs, sort positions, dates, timestamps, frozen history, permissions and grants unchanged.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
