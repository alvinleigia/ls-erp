/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash}=require('node:crypto')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const before=(await db.query('SELECT u.id,u.role,p.* FROM "TenantUserAccess" p JOIN "User" u ON u.id=p."userId" AND u."tenantId"=p."tenantId" ORDER BY u.id')).rows
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename)
  const unchanged=tables.filter(t=>!['TenantUserAccess','TenantAccessRole','StaffProfile','CustomFieldDefinition'].includes(t)),snapshots=new Map()
  for(const table of tables)snapshots.set(table,(await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row))
  const name='20261025000300_resource_action_policies',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  // Exercise failure after every transformation, including dropped columns.
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/, 'SELECT 1/0; COMMIT;')), /division by zero/)
  await db.query('ROLLBACK')
  for(const table of tables)assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row),snapshots.get(table),`${table}: rollback`)
  await db.query(sql)
  for(const table of unchanged)assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r=>r.row),snapshots.get(table),table)
  for(const row of snapshots.get('StaffProfile')){
   const next=(await db.query('SELECT to_jsonb(t) row FROM "StaffProfile" t WHERE id=$1',[row.id])).rows[0].row
   assert.equal(next.leaveApprovalMode,snapshots.get('User').find(u=>u.id===row.userId)?.role==='MANAGER'?'TENANT_ADMIN':'REPORTING_MANAGER')
   delete next.leaveApprovalMode;assert.deepEqual(next,row)
  }
  for(const row of snapshots.get('CustomFieldDefinition')){
   const next=(await db.query('SELECT to_jsonb(t) row FROM "CustomFieldDefinition" t WHERE id=$1',[row.id])).rows[0].row
   assert.deepEqual(next,{...row,visibility:row.visibility==='MANAGERS'?'PRIVILEGED':row.visibility,editability:row.editability==='MANAGERS'?'PRIVILEGED':row.editability})
  }
  for(const row of snapshots.get('TenantAccessRole')){
   const next=(await db.query('SELECT to_jsonb(t) row FROM "TenantAccessRole" t WHERE id=$1',[row.id])).rows[0].row
   for(const permission of row.permissions.filter(p=>p!=='teams.assign'))assert.ok(next.permissions.includes(permission),`${row.id}: ${permission}`)
   assert.equal(next.version,row.version+1)
   for(const key of ['permissions','version','updatedAt']){delete next[key];delete row[key]}
   assert.deepEqual(next,row)
  }
  for(const row of before){
   const next=(await db.query('SELECT * FROM "TenantUserAccess" WHERE "tenantId"=$1 AND "userId"=$2',[row.tenantId,row.userId])).rows[0]
   const own=row.role==='STAFF'?'OWN':row.salesRecordScope==='ACCOUNT_ROLE'?'ALL':row.salesRecordScope
   assert.equal(next.rules['enquiries.read'],own);assert.equal(next.rules['opportunities.edit'],own)
   assert.equal(next.rules['projects.read'],row.role==='STAFF'?'ASSIGNED':row.projectRecordScope==='ACCOUNT_ROLE'?'ALL':row.projectRecordScope)
   assert.equal(next.rules['contacts.edit'],row.role==='STAFF'?'OWN':own==='OWN'?'RELATED':own)
   assert.equal(next.rules['inventoryProducts.read'],row.role==='STAFF'?'NONE':'ALL')
   assert.equal(next.rules['leaveApprovals.approve'],row.role==='STAFF'?'NONE':'REPORTS')
   assert.equal(next.rules['activities.assign'],row.role==='STAFF'?'NONE':own==='OWN'?'RELATED':own)
   assert.equal(next.version,row.version+1);assert.ok(!('salesRecordScope' in next));assert.ok(!('projectRecordScope' in next))
   assert.equal(Object.keys(next.rules).length,174)
  }
  assert.equal((await db.query("SELECT relrowsecurity AND relforcerowsecurity secure FROM pg_class WHERE oid='\"TenantUserAccess\"'::regclass")).rows[0].secure,true)
  assert.equal((await db.query("SELECT count(*)::int n FROM \"TenantAccessRole\" WHERE 'teams.assign'=ANY(permissions)")).rows[0].n,0)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Resource/action migration: full rollback verified; ${before.length} user policies translated; ${unchanged.length} tables, memberships, owner IDs and assignments preserved exactly; field values and approval routes retained; RLS retained.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
