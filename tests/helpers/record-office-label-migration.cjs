/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto'),{Client}=require('pg')
async function main(){
  assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1')
  const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
  const db=new Client({connectionString:url.toString()});await db.connect()
  const snapshot=async()=>(await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text COLLATE "C"),'')) digest FROM (SELECT jsonb_build_array(tableoid::regclass::text,to_jsonb(t)) row FROM "BusinessCompany" t UNION ALL SELECT jsonb_build_array(tableoid::regclass::text,to_jsonb(t)) FROM "BusinessOffice" t UNION ALL SELECT jsonb_build_array(tableoid::regclass::text,to_jsonb(t)) FROM "BusinessOfficeGrant" t UNION ALL SELECT jsonb_build_array(tableoid::regclass::text,to_jsonb(t)) FROM "BusinessCompanyGrant" t) s`)).rows
  try{
    const name='20261118000100_record_office_labels',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8'),before=await snapshot()
    await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
    assert.equal((await db.query(`SELECT to_regprocedure('app.record_office_label(text,text)') value`)).rows[0].value,null)
    await db.query(sql);assert.deepEqual(await snapshot(),before)
    await db.query(`INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$3,now())`,[randomUUID(),createHash('sha256').update(sql).digest('hex'),name])
    console.log('Office label migration: forced rollback, function creation and directory/grant preservation passed.')
  }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
