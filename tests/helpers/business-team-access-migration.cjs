/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL)
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const tenant='shared_migration_fixture'
  await db.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
  await db.query('INSERT INTO "User"(id,name,email,role,"tenantId","updatedAt") VALUES($1,$1,$2,\'MANAGER\',$3,now())',[tenant,tenant+'@example.test',tenant])
  for(const scope of ['ACCOUNT_ROLE','OWN','MANAGED_TEAMS','ALL'])await db.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"crmRecordScope",version,"updatedAt") VALUES($1,$2,$3,$3,$4,$3,4,now())',[tenant+'_'+scope,tenant,scope,['salesTeams.read','salesTeams.assign','enquiries.read']])
  await db.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$1,$2,now())',[tenant,tenant+'_MANAGED_TEAMS'])
  await db.query('INSERT INTO "CrmSalesTeam"("tenantId",id,name,"nameKey",workflow,"updatedAt") VALUES($1,$1,$1,$1,\'DIRECT\',now())',[tenant])
  await db.query('INSERT INTO "CrmSalesTeamMember"("tenantId","teamId","userId","isManager") VALUES($1,$1,$1,true)',[tenant])
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const map=name=>name.replace('CrmSalesTeamMember','BusinessTeamMember').replace('CrmSalesTeam','BusinessTeam')
  const snapshot=async(after)=>Promise.all(tables.map(async name=>{
   const rows=(await db.query(`SELECT to_jsonb(t) row FROM "${after?map(name):name}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row)
   if(after) for(const row of rows){
    if(name==='TenantAccessRole'){row.crmRecordScope=row.salesRecordScope;delete row.salesRecordScope;assert.equal(row.projectRecordScope,'ACCOUNT_ROLE');delete row.projectRecordScope;row.permissions=row.permissions.map(p=>p.replace('teams.','salesTeams.'))}
    if(name==='RealEstateProject'){assert.equal(row.teamId,null);delete row.teamId}
   }
   return rows
  }))
  const before=await snapshot(false),name='20261025000100_business_team_access',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await db.query(sql);assert.deepEqual(await snapshot(true),before)
  for(const table of ['BusinessTeam','BusinessTeamMember']){const r=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[`"${table}"`])).rows[0];assert.equal(r.relrowsecurity,true);assert.equal(r.relforcerowsecurity,true)}
  await db.query('INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Business team migration preserves ${tables.length} tables, IDs, scopes, permissions and forced RLS.`)
 }finally{await db.end()}
}main().catch(e=>{console.error(e.message);process.exitCode=1})
