/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),fs=require('node:fs'),{Client}=require('pg'),{createHash,randomUUID}=require('node:crypto')
const digest=value=>createHash('md5').update(value).digest('hex')
async function main(){
 assert.equal(process.env.R5_HISTORICAL_CONTAINER,'1');const url=new URL(process.env.CRM_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/ls_salon_crm_test')
 const db=new Client({connectionString:url.toString()});await db.connect()
 try{
  const fixtures=[]
  async function profile(tenant,id,name,extra={}){
   await db.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"moduleKey",archived,version,"updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7,7,now())',[id,tenant,name,extra.nameKey??name.toLowerCase(),['contacts.read','opportunities.read'],extra.moduleKey??'all',extra.archived??false])
  }
  for(const kind of ['plain','collision','renamed','custom-id','archived','custom-key']){
   const tenant='profile_name_'+kind+'_'+randomUUID(),hash=digest(tenant),generated='account_access_109_'+hash,user=tenant+'_user'
   await db.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
   await db.query('INSERT INTO "User"(id,name,email,role,"tenantId","updatedAt") VALUES($1,$1,$2,\'MANAGER\',$3,now())',[user,user+'@example.test',tenant])
   const id=kind==='custom-id'?tenant+'_custom':generated,name=kind==='renamed'?'Regional sales access':'Account access '+hash.slice(0,12)
   await profile(tenant,id,name,{archived:kind==='archived',...(kind==='custom-key'?{nameKey:'user-customized-key'}:{})})
   await db.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[tenant,user,id])
   await db.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[tenant,user,JSON.stringify({'contacts.read':'OWN','opportunities.read':'MANAGED_TEAMS','opportunities.edit':'NONE'})])
   if(kind==='collision')for(const [index,label] of ['Existing business access','Existing business access (2)'].entries())await profile(tenant,tenant+'_existing_'+index,label)
   fixtures.push({tenant,id,kind})
  }
  const allProfiles=async()=>(await db.query('SELECT to_jsonb(r) row FROM "TenantAccessRole" r ORDER BY id')).rows.map(row=>row.row)
  const before=await allProfiles(),tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','TenantAccessRole') ORDER BY tablename")).rows.map(row=>row.tablename)
  const snapshot=async()=>Promise.all(tables.map(async table=>(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) hash,count(*)::int count FROM "${table}" t`)).rows[0]))
  const unchanged=await snapshot(),policies=(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows
  const functions=(await db.query("SELECT p.oid,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' ORDER BY p.oid")).rows
  const name='20261106000200_readable_access_profile_names',sql=fs.readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8')
  await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')),/division by zero/);await db.query('ROLLBACK')
  assert.deepEqual(await allProfiles(),before);assert.deepEqual(await snapshot(),unchanged)
  await db.query(sql)
  const after=await allProfiles();assert.equal(after.length,before.length)
  let renamed=0
  for(const old of before){
   const current=after.find(row=>row.id===old.id),hash=digest(old.tenantId)
   const eligible=old.id==='account_access_109_'+hash&&old.name==='Account access '+hash.slice(0,12)&&old.nameKey===old.name.toLowerCase()
   if(!eligible){assert.deepEqual(current,old);continue}
   renamed++;assert.match(current.name,/^Existing business access(?: \([2-9]\d*\))?$/);assert.equal(current.nameKey,current.name.toLowerCase());assert.equal(current.version,old.version+1)
   const immutable=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['name','nameKey','version','updatedAt'].includes(key)))
   assert.deepEqual(immutable(current),immutable(old))
  }
  assert(renamed>=3)
  const collision=fixtures.find(row=>row.kind==='collision');assert.equal(after.find(row=>row.id===collision.id).name,'Existing business access (3)')
  for(const kind of ['plain','archived'])assert.equal(after.find(row=>row.id===fixtures.find(f=>f.kind===kind).id).name,'Existing business access')
  assert.deepEqual(await snapshot(),unchanged)
  assert.deepEqual((await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows,policies)
  for(const prior of functions)assert.equal((await db.query('SELECT pg_get_functiondef($1::oid) body',[prior.oid])).rows[0].body,prior.body)
  await db.query(sql);assert.deepEqual(await allProfiles(),after);assert.deepEqual(await snapshot(),unchanged)
  await db.query('INSERT INTO "_prisma_migrations"(id,checksum,migration_name,finished_at) VALUES($1,$2,$1,now())',[name,createHash('sha256').update(sql).digest('hex')])
  console.log(`Access profile names: ${renamed} generated labels renamed; custom labels/collisions/archived profiles, rollback/idempotence verified; ${tables.length} other tables, assignments, permissions, scopes, policies and functions preserved.`)
 }finally{await db.end()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
