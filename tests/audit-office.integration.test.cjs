/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {prisma}=require('../lib/prisma.ts'),{createAuditReportService}=require('../platform/audit/service.ts')
const routes=[require('../app/api/reports/audit-logs/route.ts'),require('../app/api/reports/audit-logs/[id]/route.ts')]
const t='audit_office_'+randomUUID().replaceAll('-',''),other=t+'_other',admin=t+'_admin',east=t+'_east',west=t+'_west',both=t+'_both',none=t+'_none',role=t+'_role',a=t+'_a',b=t+'_b'
const permissions=['auditLogs.read','inventoryProducts.read','inventoryPurchases.read','appointments.read','shiftSchedules.read','shiftPlans.read','shiftRoster.read']
const id=name=>t+'_'+name
const ctx=(user,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(user,async()=>await fn()))
async function call(params={},user=east,key){return sessions.run({user:{id:user,tenantId:t,role:user===admin?'ADMIN':'MANAGER'}},()=>routes[key?1:0].GET(new Request('http://'+t+'.localhost/api/reports/audit-logs'+(key?'/'+id(key):'')+'?'+new URLSearchParams(params),{headers:{host:t+'.localhost'}}),{params:Promise.resolve({id:id(key)})}))}
async function report(params={},user=east,status=200,key){const response=await call(params,user,key),data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));assert.equal(response.headers.get('cache-control'),'no-store');return data}
async function entry(key,event,entityType,office,created='2036-02-04T10:00Z',extra={}){
 const metadata={...extra.metadata,...(office?{officeId:office}:{} )}
 await root.query(`INSERT INTO "AuditLog"(id,"tenantId",event,"entityType","entityId","actorUserId","actorRole","requestId","createdAt",metadata,before,after) VALUES($1,$2,$3,$4,$5,$6,'MANAGER',$7,$8,$9,$10,$11)`,[id(key),t,event,entityType,id(key)+'_source',east,id(key)+'_request',created,metadata,extra.before||{note:'Before',api_key:'old-secret'},extra.after||{note:key,password:'hidden-password'}])
}
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
 const initial=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id
 for(const [office,label]of[[a,'EAST'],[b,'WEST']])await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") SELECT $1,$2,"companyId",$3,$3,now() FROM "BusinessOffice" WHERE id=$4',[office,t,label,initial])
 for(const [user,r]of[[admin,'ADMIN'],[east,'MANAGER'],[west,'STAFF'],[both,'MANAGER'],[none,'MANAGER']])await root.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||'@example.test',$3,now())`,[user,t,r])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,permissions])
 for(const [user,offices]of[[east,[a]],[west,[b]],[both,[a,b]],[none,[]],[admin,[a,b]]]){
  if(user!==admin){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,user,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,user,role])}
  await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,1,now())',[t,user,offices[0]||null]);for(const office of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,user,office])
 }
 for(const key of ['crm','realEstate','salesDocuments','salesOrders','receivables','catalog','inventory','services','appointments','leaves','shifts'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key])
 await root.query(`INSERT INTO "AppSetting"(id,"tenantId","timeZone","dateFormat","updatedAt") VALUES($1,$1,'Asia/Kolkata','dd/MM/yyyy',now())`,[t])
 for(const [suffix,office]of[['east',a],['west',b]]){
  await entry('stock_'+suffix,'inventory.stock.updated','inventoryStock',office,undefined,{metadata:{officeFamily:'inventory'}})
  await entry('booking_'+suffix,'appointment.updated','Appointment',office)
  await entry('schedule_'+suffix,'workforce.shiftSchedules.edit','shiftSchedules',office)
  await entry('plan_'+suffix,'workforce.shiftPlans.edit','shiftPlans',office,undefined,{metadata:{officeFamily:'flexiblePlans'}})
  await entry('roster_'+suffix,'workforce.shiftRoster.edit','shiftRoster',office,undefined,{metadata:{officeFamily:'dailyRoster'}})
 }
 await entry('shared','inventory.inventoryProducts.edit','inventoryProducts')
 await entry('security','access.assignment.updated','User')
 await entry('team','crm.team.manager.updated','BusinessTeam')
 await entry('unknown','inventory.futureModule.created','Unregistered')
 await entry('quote','crm.quotation.updated','TestQuotation')
 await entry('addon_catalog','catalog.item.updated','TestCatalog',undefined,undefined,{before:{extensionKey:'realEstate',note:'Private add-on context'},after:{archived:true}})
 await entry('addon','realEstate.project.updated','TestProject')
 await entry('before','inventory.stock.updated','inventoryStock',a,'2036-02-03T18:29:59.999Z')
 await entry('boundary','inventory.stock.updated','inventoryStock',a,'2036-02-03T18:30:00Z')
 await entry('after','inventory.stock.updated','inventoryStock',a,'2036-02-04T18:30:00Z')
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})
const period={dateFrom:'2036-02-04',dateTo:'2036-02-04'}
test('stock, booking and workforce audit headers/counts/details intersect native office Read',async()=>{
 const data=await report({...period,pageSize:'100'});assert.equal(data.total,7)
 for(const key of ['stock','booking','schedule','plan','roster']){assert.ok(data.items.some(x=>x.id===id(key+'_east')));await report({},east,404,key+'_west');assert.equal((await report({},east,200,key+'_east')).after.note,key+'_east')}
 assert.ok(!JSON.stringify(data).includes('_west'));assert.ok(data.items.every(row=>!('before'in row)&&!('metadata'in row)));assert.equal(data.context.timeZone,'Asia/Kolkata')
 const all=await report({...period,pageSize:'100'},both);assert.equal(all.total,12);assert.equal((await report({...period},west)).total,6)
})
test('shared events stay shared while source permissions, modules and office grants remain separate',async()=>{
 assert.deepEqual((await report(period,none)).items.map(x=>x.id),[id('shared')]);await report({},none,404,'stock_east')
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions.filter(p=>p!=='inventoryProducts.read'),role]);try{await report({},east,404,'stock_east');await report({},east,404,'shared');assert.equal((await report(period)).total,4)}finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions,role])}
 await root.query(`UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key='shifts'`,[t]);try{assert.equal((await report(period)).total,4);await report({},east,404,'schedule_east')}finally{await root.query(`UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key='shifts'`,[t])}
})
test('unknown families fail closed and nested families cannot fall back to a broad prefix',async()=>{
 await report({},admin,404,'unknown');await report({},east,404,'security');assert.equal((await report({category:'security'})).total,0)
 assert.equal((await report({category:'security'},admin)).total,2)
 await root.query(`UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key IN ('crm','realEstate','salesDocuments')`,[t]);try{await report({},admin,404,'quote');await report({},admin,404,'addon');await report({},admin,404,'addon_catalog');await report({},admin,200,'team')}finally{await root.query(`UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key IN ('crm','realEstate','salesDocuments')`,[t])}
})
test('full-scope reservation reviewers retain their composed family without an administrator role fallback',async()=>{
 // Isolate family authorization here; canonical item/order ancestry is protected
 // separately by the native reservation and office audit preservation suites.
 await entry('reservation','catalog.reservation.created','TestReservation')
 await report({},east,404,'reservation')
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[[...permissions,'catalogItems.read','unitReservations.read','salesOrders.read'],role])
 try{
  await report({},east,200,'reservation')
  await report({},east,404,'addon_catalog')
  await report({},admin,200,'addon_catalog')
  const rules=(await root.query('SELECT rules FROM "TenantUserAccess" WHERE "userId"=$1',[east])).rows[0].rules
  await root.query('UPDATE "TenantUserAccess" SET rules=$1 WHERE "userId"=$2',[{...rules,'salesOrders.read':'OWN'},east])
  try{await report({},east,404,'reservation')}finally{await root.query('UPDATE "TenantUserAccess" SET rules=$1 WHERE "userId"=$2',[rules,east])}
 }finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions,role])}
})
test('all exact filters/search/page counts narrow the same permitted population and escape SQL input',async()=>{
 const filtered=await report({...period,event:'inventory.stock.',q:'stock_east',actorUserId:east,entityType:'inventoryStock',entityId:id('stock_east')+'_source',requestId:id('stock_east')+'_request'});assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,id('stock_east'))
 assert.equal((await report({...period,q:'stock_west'})).total,0)
 for(const key of ['q','event','entityType','entityId','requestId','actorUserId'])assert.equal((await report({...period,[key]:"' OR true --"})).total,0)
 const first=await report({...period,pageSize:'2'}),second=await report({...period,pageSize:'2',page:'2'});assert.equal(first.total,second.total);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,4)
 const empty=await report({...period,page:'100'});assert.equal(empty.items.length,0);assert.equal(empty.total,7)
})
test('tenant-calendar dates, closed offices, credentials and workspace-independent history are preserved',async()=>{
 assert.equal((await report({...period,event:'inventory.stock.'})).total,2)
 const detail=await report({},east,200,'stock_east');assert.equal(detail.before.api_key,'[redacted]');assert.equal(detail.after.password,'[redacted]');assert.ok(!JSON.stringify(detail).includes('hidden-password'))
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a]);try{await report({},east,200,'stock_east');await report({},east,200,'booking_east')}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
 const before=await report(period,both);await root.query('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=$1,version=version+1 WHERE "tenantId"=$2 AND "userId"=$3',[b,t,both]);assert.equal((await report(period,both)).total,before.total)
})
test('current office/profile/account revocation guards list and detail, without relying on session role',async()=>{
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2',[t,east]);try{assert.equal((await report(period)).total,1);await report({},east,404,'stock_east')}finally{await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,east,a])}
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[[],role]);try{await report({},east,403);await report({},east,403,'stock_east')}finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions,role])}
 await root.query(`UPDATE "User" SET status='SUSPENDED' WHERE id=$1`,[east]);try{await report({},east,403)}finally{await root.query(`UPDATE "User" SET status='ACTIVE' WHERE id=$1`,[east])}
})
test('a report queued behind security administration reauthorizes after the tenant row lock',async()=>{
 await root.query('BEGIN');await root.query('SELECT id FROM "Tenant" WHERE id=$1 FOR UPDATE',[t])
 const pending=ctx(east,()=>createAuditReportService(prisma,{tenantId:t,userId:east}).list({})).then(value=>({value}),error=>({error}))
 try{
  let blocked=false;for(let i=0;i<100;i++){await root.query('SELECT pg_stat_clear_snapshot()');blocked=(await root.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%' LIMIT 1")).rowCount>0;if(blocked)break;await new Promise(r=>setTimeout(r,50))}assert.equal(blocked,true)
  await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[[],role]);await root.query('COMMIT');assert.equal((await pending).error?.status,403)
 }finally{await root.query('ROLLBACK');await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[permissions,role]);await pending}
})
test('native tenant isolation and strict validation cover details, unknown filters and unsupported dates',async()=>{
 for(const params of [{dateFrom:'2036-02-31'},{dateFrom:'2036-02-05',dateTo:'2036-02-04'},{dateTo:'9999-12-31'},{sort:'metadata'},{officeId:b},{format:'csv'},{fields:'before'}])await report(params,east,400)
 const before=(await root.query('SELECT count(*) n FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows[0].n
 await report(period);assert.equal((await root.query('SELECT count(*) n FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows[0].n,before)
 const service=createAuditReportService(prisma,{tenantId:other,userId:east});await assert.rejects(runWithTenantDbContext(other,()=>runWithDatabaseActor(east,async()=>await service.list({}))),error=>error.status===403)
})
