/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tenant='leave_office_upgrade'
  await db.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
  await db.query('INSERT INTO "User"(id,"tenantId",email,role,"updatedAt") VALUES($1,$2,\'upgrade-leave@example.test\',\'STAFF\',now())',[tenant,tenant])
  await db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$1,now())',[tenant])
  await db.query('INSERT INTO "LeaveDefinition"(id,"tenantId",code,name,"leaveType","updatedAt") VALUES($1,$1,\'CURRENT\',\'Current name\',\'PAID\',now())',[tenant])
  await db.query('INSERT INTO "LeaveRequest"(id,"staffProfileId","leaveDefinitionId","startDate","endDate","daysCount",status,reason,"createdAt","updatedAt") VALUES($1,$1,$1,\'2020-01-01\',\'2020-01-01\',1,\'APPROVED\',\'Private original reason\',\'2020-01-01\',\'2020-01-02\')',[tenant])
  await db.query('INSERT INTO "StaffRosterHistoryDay"(id,"staffProfileId",date,source,"leaveRequestId","leaveDefinitionCode","leaveDefinitionName","leaveReason","createdAt","updatedAt") VALUES($1,$1,\'2020-01-01\',\'LEAVE\',$1,\'FROZEN\',\'Original historic name\',\'Original historic reason\',\'2020-01-01\',\'2020-01-03\')',[tenant])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  // Several tables have composite keys rather than an id column.
  const capture=async()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(row=>row.row)))
  const before=await capture(),name='20261026000700_leave_office_ownership',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  const tenantByRequest=new Map((await db.query('SELECT r.id,u."tenantId" FROM "LeaveRequest" r JOIN "StaffProfile" s ON s.id=r."staffProfileId" JOIN "User" u ON u.id=s."userId"')).rows.map(row=>[row.id,row.tenantId]))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const previousPolicies=await policies()
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before)
  assert.deepEqual(await policies(),previousPolicies)
  assert.equal((await db.query("SELECT to_regclass('public.\"StaffRosterLeaveSnapshot\"') f")).rows[0].f,null)
  await db.query(sql)
  // Reconstruct original history through its new private relation. Every old
  // field and timestamp must survive, including names differing from live data.
  const after=await Promise.all(tables.map(async table=>{
   let query=`SELECT to_jsonb(t) row FROM "${table}" t`
   if(table==='LeaveRequest')query=`SELECT to_jsonb(t)-'officeId' row FROM "${table}" t`
   if(table==='StaffRosterHistoryDay')query=`SELECT to_jsonb(h)||jsonb_build_object('source',COALESCE(s.source,h.source),'leaveRequestId',s."leaveRequestId",'leaveDefinitionCode',s."leaveDefinitionCode",'leaveDefinitionName',s."leaveDefinitionName",'leaveReason',s."leaveReason") row FROM "StaffRosterHistoryDay" h LEFT JOIN "StaffRosterLeaveSnapshot" s ON s."historyId"=h.id`
   return(await db.query(`SELECT row FROM (${query}) q ORDER BY row::text COLLATE "C"`)).rows.map(row=>row.row)
  }))
  const expected=structuredClone(before);for(const row of expected[tables.indexOf('LeaveRequest')])if(row.tenantId===null)row.tenantId=tenantByRequest.get(row.id)
  const ordered=value=>value.map(rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))
  assert.deepEqual(ordered(after),ordered(expected));assert.equal((await db.query('SELECT "officeId" FROM "LeaveRequest" WHERE id=$1',[tenant])).rows[0].officeId,(await db.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[tenant])).rows[0].id)
  const generic=(await db.query('SELECT * FROM "StaffRosterHistoryDay" WHERE id=$1',[tenant])).rows[0];assert.equal(generic.source,'UNAVAILABLE');assert(!('leaveReason' in generic))
  assert.equal((await db.query('SELECT "leaveReason" FROM "StaffRosterLeaveSnapshot" WHERE "historyId"=$1',[tenant])).rows[0].leaveReason,'Original historic reason')
  assert.equal((await db.query("SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE relname='StaffRosterLeaveSnapshot'")).rows[0].secure,true)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  if(process.env.R10_SINGLE_OFFICE_FIXTURES==='1')await db.query('CREATE TRIGGER aaa_test_record_office_fixture BEFORE INSERT ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION app.test_record_office_fixture()')
  console.log(`Leave office ownership: rollback verified; ${tables.length} preceding tables preserved with exact snapshot reconstruction; missing tenant normalized; historical names/reasons, IDs, timestamps and grants preserved.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
