/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const t='booking_upgrade_fixture';await db.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[t])
  for(const [id,role]of[[t+'_staff','STAFF'],[t+'_customer','CUSTOMER']])await db.query('INSERT INTO "User"(id,email,role,"tenantId","updatedAt") VALUES($1,$1||\'@example.test\',$2,$3,now())',[id,role,t])
  await db.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$2,now())',[t,t+'_staff'])
  await db.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$1,\'Saved category\',now())',[t])
  await db.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$1,$1,\'Saved catalog\',60,99999,now())',[t])
  await db.query('INSERT INTO "AppointmentOrder"(id,"customerId","appointmentDate","appointmentStartAt",status,"subtotalCents","totalCents","invoiceBranding","updatedAt") VALUES($1,$2,\'2036-02-04\',\'2036-02-04 10:00\',\'CONFIRMED\',12345,14000,\'{"name":"Saved brand"}\',\'2020-01-01\')',[t,t+'_customer'])
  await db.query('INSERT INTO "AppointmentOrderLine"(id,"orderId","serviceId","staffProfileId","durationMinutes","unitPriceCents","startAt","endAt","updatedAt") VALUES($1,$1,$1,$1,60,12345,\'2036-02-04 10:00\',\'2036-02-04 11:00\',\'2020-01-01\')',[t])
  await db.query('INSERT INTO "Appointment"(id,"staffProfileId","customerId","serviceId","orderLineId","startAt","endAt","updatedAt") VALUES($1,$1,$2,$1,$1,\'2036-02-04 10:00\',\'2036-02-04 11:00\',\'2020-01-01\')',[t,t+'_customer'])
  await db.query('INSERT INTO "AppointmentOrderCoupon"(id,"orderId",code,"discountType","discountValue","discountCents") VALUES($1,$1,\'SAVED\',\'AMOUNT\',100,100)',[t])
  await db.query('INSERT INTO "AppointmentOrderTax"(id,"orderId",name,percent,"taxCents") VALUES($1,$1,\'Saved tax\',17.5,1755)',[t])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const capture=()=>Promise.all(tables.map(async table=>(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)))
  const policies=async()=>(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const functions=async()=>(await db.query("SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid")).rows
  const before=await capture(),oldPolicies=await policies(),oldFunctions=await functions(),name='20261026001600_appointment_offices',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  // Inconsistent historical financial links must abort, never be silently rewritten.
  await db.query(`UPDATE "AppointmentOrderLine" SET "endAt"="endAt"+interval '1 minute' WHERE id=$1`,[t])
  await assert.rejects(db.query(sql),/Booking historical source relations disagree/);await db.query('ROLLBACK')
  await db.query(`UPDATE "AppointmentOrderLine" SET "endAt"="endAt"-interval '1 minute' WHERE id=$1`,[t])
  assert.deepEqual(await capture(),before)
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0;COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await capture(),before);assert.deepEqual(await policies(),oldPolicies);assert.deepEqual(await functions(),oldFunctions)
  await db.query(sql)
  const offices=new Map((await db.query('SELECT "tenantId",id FROM "BusinessOffice" WHERE "isInitial"')).rows.map(r=>[r.tenantId,r.id])),users=new Map(before[tables.indexOf('User')].map(r=>[r.id,r.tenantId])),expected=structuredClone(before)
  for(const tbl of ['Appointment','AppointmentOrder'])for(const row of expected[tables.indexOf(tbl)]){row.tenantId??=users.get(row.customerId);row.officeId=offices.get(row.tenantId)}
  for(const row of expected[tables.indexOf('AuditLog')])if(row.entityType==='Appointment'||(row.entityType==='order'&&row.event.startsWith('appointments.')))row.metadata={...row.metadata,officeId:offices.get(row.tenantId),officeFamily:'appointments'}
  const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x,norm=rows=>rows.map(x=>JSON.stringify(stable(x))).sort(),after=await capture()
  for(let i=0;i<tables.length;i++)assert.deepEqual(norm(after[i]),norm(expected[i]),tables[i])
  const currentPolicies=await policies();for(const old of oldPolicies)assert.deepEqual(currentPolicies.find(p=>p.tablename===old.tablename&&p.policyname===old.policyname),old)
  const currentFunctions=await functions();for(const old of oldFunctions)assert.deepEqual(currentFunctions.find(f=>f.oid===old.oid),old)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  if(process.env.R10_BOOKING_FIXTURES==='1')await db.query(`CREATE FUNCTION app.test_booking_office_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW."tenantId" IS NULL THEN SELECT "tenantId" INTO NEW."tenantId" FROM "User" WHERE id=NEW."customerId";END IF;
   IF NEW."officeId" IS NULL AND TG_TABLE_NAME='Appointment' THEN SELECT o."officeId" INTO NEW."officeId" FROM "AppointmentOrderLine" l JOIN "AppointmentOrder" o ON o.id=l."orderId" WHERE l.id=to_jsonb(NEW)->>'orderLineId';END IF;
   IF NEW."officeId" IS NULL THEN SELECT id INTO NEW."officeId" FROM "BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND "isInitial";END IF;RETURN NEW;
  END $$;CREATE TRIGGER aaa_test_booking_fixture BEFORE INSERT ON "Appointment" FOR EACH ROW EXECUTE FUNCTION app.test_booking_office_fixture();CREATE TRIGGER aaa_test_booking_fixture BEFORE INSERT ON "AppointmentOrder" FOR EACH ROW EXECUTE FUNCTION app.test_booking_office_fixture();`)
  console.log(`Appointment offices: forced rollback and prior functions/policies/grants verified; ${tables.length} tables preserved except explicit ownership/tenant inference/audit metadata. Saved prices, branding, links, timestamps and staff assignments unchanged.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
