/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const capture=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const before=await capture(),oldPolicies=await policies(),name='20261026001000_standard_schedule_offices',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies)
  await db.query(sql)
  const offices=new Map((await db.query('SELECT "tenantId",id FROM "BusinessOffice" WHERE "isInitial"')).rows.map(r=>[r.tenantId,r.id]))
  const after=await capture(),expected=structuredClone(before)
  for(const row of expected[tables.indexOf('ShiftSchedule')])row.officeId=offices.get(row.tenantId)
  const users=new Map(before[tables.indexOf('User')].map(r=>[r.id,r.tenantId])),profiles=new Map(before[tables.indexOf('StaffProfile')].map(r=>[r.id,users.get(r.userId)]))
  for(const row of expected[tables.indexOf('StaffRosterHistoryDay')]){row.tenantId=profiles.get(row.staffProfileId);row.officeId=offices.get(row.tenantId)}
  for(const row of expected[tables.indexOf('AuditLog')])if(row.entityType==='shiftSchedules'&&offices.has(row.tenantId)&&!row.metadata?.officeId)row.metadata={...row.metadata,officeId:offices.get(row.tenantId)}
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;const normalized=rows=>rows.map(x=>JSON.stringify(stable(x))).sort();for(let i=0;i<tables.length;i++)assert.deepEqual(normalized(after[i]),normalized(expected[i]),tables[i])
  const allPolicies=await policies();for(const p of oldPolicies)assert.deepEqual(allPolicies.find(r=>r.tablename===p.tablename&&r.policyname===p.policyname),p)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  if(process.env.R10_SINGLE_OFFICE_FIXTURES==='1'){
   await db.query(`CREATE FUNCTION app.test_staff_workplace_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
     INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") SELECT u."tenantId",NEW.id,1,now() FROM "User" u WHERE u.id=NEW."userId" ON CONFLICT DO NOTHING;
     INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") SELECT gen_random_uuid()::text,u."tenantId",NEW.id,o.id,now() FROM "User" u JOIN "BusinessOffice" o ON o."tenantId"=u."tenantId" AND o."isInitial" WHERE u.id=NEW."userId" ON CONFLICT DO NOTHING;
    END IF; RETURN NEW; END $$;CREATE TRIGGER test_staff_workplace_fixture AFTER INSERT ON "StaffProfile" FOR EACH ROW EXECUTE FUNCTION app.test_staff_workplace_fixture();`)
   await db.query('CREATE TRIGGER aaa_test_record_office_fixture BEFORE INSERT ON "ShiftSchedule" FOR EACH ROW EXECUTE FUNCTION app.test_record_office_fixture()')
  }
  console.log(`Schedule offices: rollback and prior policies verified; all ${tables.length} preceding tables preserved after adding only ownership/audit metadata; frozen names, times, grants and private leave evidence unchanged.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
