/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
const roots=['CrmEnquiry','CrmOpportunity','CrmTask','RealEstateProject','CrmEnquiryImport','CrmPlanLaunch']
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshot=async(after=false)=>Promise.all(tables.map(async tbl=>{const trim=after&&roots.includes(tbl)?`-'officeId'${tbl==='CrmEnquiry'?"-'importId'":''}`:'';return(await db.query(`SELECT to_jsonb(t)${trim} row FROM "${tbl}" t ORDER BY (to_jsonb(t)${trim})::text COLLATE "C"`)).rows.map(r=>r.row)}))
  const before=await snapshot(),name='20261026000300_sales_office_ownership',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='"CrmTask"'::regclass AND tgname='crm_task_legacy_bridge'`)).rows[0].tgenabled,'O')
  await db.query(sql);assert.deepEqual(await snapshot(true),before)
  for(const tbl of roots){
   assert.equal((await db.query(`SELECT count(*)::integer n FROM "${tbl}" r LEFT JOIN "BusinessOffice" o ON o."tenantId"=r."tenantId" AND o.id=r."officeId" WHERE o.id IS NULL OR NOT o."isInitial"`)).rows[0].n,0)
   assert.equal((await db.query('SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE relname=$1',[tbl])).rows[0].secure,true)
  }
  assert.equal((await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgrelid='"CrmTask"'::regclass AND tgname='crm_task_legacy_bridge'`)).rows[0].tgenabled,'O')
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Sales office ownership: rollback verified; ${tables.length} prior tables preserved after excluding only new office/import fields; six roots backfilled; timestamps, owners, grants and frozen snapshots unchanged.`)
  if(process.env.R10_SINGLE_OFFICE_FIXTURES==='1'){
   // Frozen R9 workflows intentionally model one pre-existing office. Only their
   // privileged local data factories supply this explicit fixture metadata.
   // Runtime-role operations and the office-isolation suite do not get a fallback.
   await db.query(`CREATE FUNCTION app.test_user_office_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) AND NEW."tenantId" IS NOT NULL THEN
     INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId","updatedAt") SELECT NEW."tenantId",NEW.id,id,now() FROM "BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND "isInitial" ON CONFLICT DO NOTHING;
     INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") SELECT "tenantId","userId","creationOfficeId" FROM "BusinessOfficePolicy" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW.id ON CONFLICT DO NOTHING;
    END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_user_office_fixture AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION app.test_user_office_fixture();
    CREATE FUNCTION app.test_record_office_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     IF NEW."officeId" IS NULL AND nullif(current_setting('app.actor_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN SELECT id INTO NEW."officeId" FROM "BusinessOffice" WHERE "tenantId"=NEW."tenantId" AND "isInitial"; END IF;
     RETURN NEW; END $$;`)
   for(const tbl of roots)await db.query(`CREATE TRIGGER aaa_test_record_office_fixture BEFORE INSERT ON "${tbl}" FOR EACH ROW EXECUTE FUNCTION app.test_record_office_fixture()`)
  }
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
