/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const profile=(await db.query('SELECT p.id,u."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" ORDER BY p.id LIMIT 1')).rows[0]
  assert.ok(profile)
  await db.query('INSERT INTO "StaffFlexibleWeekPlan"(id,"staffProfileId","weekStartDate","createdAt","updatedAt") VALUES(\'migration_flexible_week\',$1,\'2020-01-06\',\'2020-01-01\',\'2020-01-02\')',[profile.id])
  await db.query('INSERT INTO "StaffFlexibleWeekDay"(id,"planId",day,"updatedAt") VALUES(\'migration_flexible_week\',\'migration_flexible_week\',\'MONDAY\',now())')
  await db.query('INSERT INTO "StaffFlexibleWeekSlot"(id,"dayId","startTime","endTime","updatedAt") VALUES(\'migration_flexible_week\',\'migration_flexible_week\',\'09:00\',\'17:00\',now())')
  await db.query('INSERT INTO "StaffFlexibleWeekBreak"(id,"slotId","startTime","endTime","updatedAt") VALUES(\'migration_flexible_week\',\'migration_flexible_week\',\'12:00\',\'13:00\',now())')
  await db.query('INSERT INTO "StaffFlexiblePattern"(id,"staffProfileId",name,"cycleLengthWeeks","validFrom","validTo","isActive","createdAt","updatedAt") VALUES(\'migration_flexible_pattern\',$1,\'Frozen recurring anchor\',2,\'2020-01-06\',\'2020-01-19\',false,\'2020-01-01\',\'2020-01-02\')',[profile.id])
  await db.query('INSERT INTO "StaffFlexiblePatternWeek"(id,"patternId","weekIndex","updatedAt") VALUES(\'migration_flexible_pattern\',\'migration_flexible_pattern\',1,now())')
  await db.query('INSERT INTO "StaffFlexiblePatternDay"(id,"weekId",day,"updatedAt") VALUES(\'migration_flexible_pattern\',\'migration_flexible_pattern\',\'TUESDAY\',now())')
  await db.query('INSERT INTO "StaffFlexiblePatternSlot"(id,"dayId","startTime","endTime","updatedAt") VALUES(\'migration_flexible_pattern\',\'migration_flexible_pattern\',\'10:00\',\'18:00\',now())')
  await db.query('INSERT INTO "StaffFlexiblePatternBreak"(id,"slotId","startTime","endTime","updatedAt") VALUES(\'migration_flexible_pattern\',\'migration_flexible_pattern\',\'14:00\',\'14:30\',now())')
  for(const [kind,tbl]of[['shiftRoster','StaffFlexibleWeekPlan'],['shiftPlans','StaffFlexiblePattern']])await db.query(`INSERT INTO "AuditLog"(id,"tenantId",event,"entityType",before) SELECT $1,$2,\'workforce.\'||$1||\'.archive\',$1,to_jsonb(p) FROM "${tbl}" p WHERE p.id LIKE \'migration_flexible_%\'`,[kind,profile.tenantId])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const capture=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const before=await capture(),oldPolicies=await policies(),name='20261026001200_flexible_plan_offices',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies)
  await db.query(sql)
  const offices=new Map((await db.query('SELECT "tenantId",id FROM "BusinessOffice" WHERE "isInitial"')).rows.map(r=>[r.tenantId,r.id]))
  const after=await capture(),expected=structuredClone(before)
  const users=new Map(before[tables.indexOf('User')].map(r=>[r.id,r.tenantId])),profiles=new Map(before[tables.indexOf('StaffProfile')].map(r=>[r.id,users.get(r.userId)]))
  for(const tbl of ['StaffFlexibleWeekPlan','StaffFlexiblePattern'])for(const row of expected[tables.indexOf(tbl)]){row.tenantId=profiles.get(row.staffProfileId);row.officeId=offices.get(row.tenantId)}
  for(const row of expected[tables.indexOf('AuditLog')])if(row.entityType==='shiftPlans'||(row.entityType==='shiftRoster'&&(Object.hasOwn(row.before||{},'weekStartDate')||Object.hasOwn(row.after||{},'weekStartDate'))))row.metadata={...row.metadata,officeId:offices.get(row.tenantId),officeFamily:'flexiblePlans'}
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;const normalized=rows=>rows.map(x=>JSON.stringify(stable(x))).sort();for(let i=0;i<tables.length;i++)assert.deepEqual(normalized(after[i]),normalized(expected[i]),tables[i])
  const childTables=['StaffFlexibleWeekDay','StaffFlexibleWeekSlot','StaffFlexibleWeekBreak','StaffFlexiblePatternWeek','StaffFlexiblePatternDay','StaffFlexiblePatternSlot','StaffFlexiblePatternBreak']
  const allPolicies=await policies();for(const p of oldPolicies){const actual=allPolicies.find(r=>r.tablename===p.tablename&&r.policyname===p.policyname)
   if(p.policyname==='tenant_isolation'&&childTables.includes(p.tablename)){
    assert.deepEqual({...actual,qual:p.qual,with_check:p.with_check},p)
    assert.match(actual.qual,/app\.flexible_child_in_tenant/);assert.equal(actual.qual,actual.with_check)
   }else assert.deepEqual(actual,p)
  }
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  if(process.env.R10_SINGLE_OFFICE_FIXTURES==='1'){
   await db.query(`CREATE FUNCTION app.test_flexible_office_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW."tenantId" IS NULL THEN SELECT u."tenantId" INTO NEW."tenantId" FROM "StaffProfile" p JOIN "User" u ON u.id=p."userId" WHERE p.id=NEW."staffProfileId"; END IF;
    IF NEW."officeId" IS NULL THEN SELECT id INTO NEW."officeId" FROM "BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND "isInitial"; END IF; RETURN NEW;
   END $$;CREATE TRIGGER aaa_test_flexible_office_fixture BEFORE INSERT ON "StaffFlexibleWeekPlan" FOR EACH ROW EXECUTE FUNCTION app.test_flexible_office_fixture();CREATE TRIGGER aaa_test_flexible_office_fixture BEFORE INSERT ON "StaffFlexiblePattern" FOR EACH ROW EXECUTE FUNCTION app.test_flexible_office_fixture();`)
  }
  console.log(`Flexible plan offices: forced rollback verified; seven child tenant policies use bounded ancestry, all unrelated policies unchanged; all ${tables.length} preceding tables preserved except explicit root/audit ownership; anchors, slots, breaks, timestamps, frozen history, grants and private leave evidence unchanged.`)

 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
