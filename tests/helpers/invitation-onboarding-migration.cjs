/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const user=(await db.query('SELECT id,"tenantId" FROM "User" WHERE role=\'ADMIN\' AND "tenantId" IS NOT NULL LIMIT 1')).rows[0];assert(user)
  for(const accepted of [false,true])await db.query('INSERT INTO "Invitation"(id,"tenantId",email,token,"invitedById","expiresAt","acceptedAt") VALUES($1,$2,$3,$4,$5,now()+interval \'1 day\',$6)', ['migration_invite_'+accepted,user.tenantId,'migration-'+accepted+'@example.test','local-migration-token-'+accepted,user.id,accepted?new Date():null])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(row=>row.tablename)
  const snapshot=async(after=false)=>Promise.all(tables.map(async table=>{const trim=after&&table==='Invitation'?"-'accessConfiguration'":'';return(await db.query(`SELECT to_jsonb(t)${trim} row FROM "${table}" t ORDER BY (to_jsonb(t)${trim})::text COLLATE "C"`)).rows.map(row=>row.row)}))
  const before=await snapshot(),name='20261026000400_invitation_onboarding',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before)
  assert.equal((await db.query("SELECT to_regprocedure('app.invitation_accept_context(text,text)') f")).rows[0].f,null)
  await db.query(sql);assert.deepEqual(await snapshot(true),before)
  assert.equal((await db.query('SELECT count(*)::int n FROM "Invitation" WHERE "accessConfiguration"<>\'{}\'::jsonb')).rows[0].n,0)
  assert.equal((await db.query('SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE relname=\'Invitation\'')).rows[0].secure,true)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Invitation onboarding: rollback verified; ${tables.length} preceding tables preserved, including pending/accepted invitations and existing passwords/grants; forced RLS enabled.`)
 }finally{await db.end()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
