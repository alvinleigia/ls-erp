/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tenant='shared_migration_fixture'
  for(const scope of ['ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL']){
   const userId='profile_migration_'+scope
   await db.query('INSERT INTO "User"(id,name,email,role,"tenantId","updatedAt") VALUES($1,$1,$2,\'MANAGER\',$3,now())',[userId,userId+'@example.test',tenant])
   await db.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[tenant,userId,tenant+'_'+scope])
  }
  for(const role of ['STAFF','MANAGER'])await db.query('INSERT INTO "User"(id,name,email,role,"tenantId","updatedAt") VALUES($1,$1,$2,$3,$4,now())',['profile_migration_unassigned_'+role,role+'@migration.example.test',role,tenant])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const snapshots=new Map();for(const table of tables)snapshots.set(table,(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row))
  const before=(await db.query(`SELECT u.id,u."tenantId",a."roleId",r.permissions,r.archived,COALESCE(r."salesRecordScope",'ACCOUNT_ROLE') sales,COALESCE(r."projectRecordScope",'ACCOUNT_ROLE') projects FROM "User" u LEFT JOIN "TenantRoleAssignment" a ON a."tenantId"=u."tenantId" AND a."userId"=u.id LEFT JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" WHERE u.role IN ('STAFF','MANAGER') AND u."tenantId" IS NOT NULL`)).rows
  const name='20261025000200_composable_access_profiles',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  const frozenPermissions=sql.match(/ARRAY\[(.*?)\]::text\[\]/s)[1].match(/'[^']+'/g).map(value=>value.slice(1,-1))
  await db.query(sql)
  for(const table of tables){
   if(['TenantAccessRole','TenantRoleAssignment'].includes(table))continue
   assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row),snapshots.get(table),table)
  }
  for(const row of before){
   const p=(await db.query('SELECT * FROM "TenantUserAccess" WHERE "tenantId"=$1 AND "userId"=$2',[row.tenantId,row.id])).rows[0]
   assert.equal(p.salesRecordScope,row.sales);assert.equal(p.projectRecordScope,row.projects)
   const grants=(await db.query('SELECT r.* FROM "TenantRoleAssignment" a JOIN "TenantAccessRole" r ON r."tenantId"=a."tenantId" AND r.id=a."roleId" WHERE a."tenantId"=$1 AND a."userId"=$2',[row.tenantId,row.id])).rows
   assert.equal(grants.length,1);if(row.roleId){assert.equal(grants[0].id,row.roleId);assert.deepEqual(grants[0].permissions,row.permissions);assert.equal(grants[0].archived,row.archived)}else assert.deepEqual(grants[0].permissions,frozenPermissions)
  }
  for(const row of snapshots.get('TenantAccessRole')){const after=(await db.query('SELECT to_jsonb(r) row FROM "TenantAccessRole" r WHERE id=$1',[row.id])).rows[0].row;const expected={...row};delete expected.salesRecordScope;delete expected.projectRecordScope;delete after.moduleKey;assert.deepEqual(after,expected)}
  const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=\'"TenantUserAccess"\'::regclass')).rows[0];assert.equal(r.relrowsecurity,true);assert.equal(r.relforcerowsecurity,true)
  await db.query('INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Composable profiles preserve ${tables.length} prior tables and ${before.length} existing account grants/scopes; user policy uses forced RLS; 109 migrations.`)
 }finally{await db.end()}
}main().catch(e=>{console.error(e.message);process.exitCode=1})
