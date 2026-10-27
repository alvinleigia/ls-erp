/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {GET}=require('../app/api/reports/coupon-usage/route.ts')
const {couponUsageReport,couponReportQuery}=require('../modules/appointments/coupon-report.ts')
const t='coupon_'+randomUUID().replaceAll('-',''),other=t+'_other',admin=t+'_admin',east=t+'_east',west=t+'_west',both=t+'_both',none=t+'_none',role=t+'_role',a=t+'_a',b=t+'_b'
const names=['used','plain','mixed','hidden','unbooked','canceled','before','after','boundary']
const id=name=>t+'_'+name
const ctx=(user,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(user,async()=>await fn()))
async function call(params={},user=east){return sessions.run({user:{id:user,tenantId:t,role:user===admin?'ADMIN':'MANAGER'}},()=>GET(new Request('http://'+t+'.localhost/api/reports/coupon-usage?'+new URLSearchParams(params),{headers:{host:t+'.localhost'}})))}
async function report(params={},user=east,status=200){const response=await call(params,user),data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
async function booking(name,customer,office,codes=[],created='2036-02-04T10:00:00Z',status='DRAFT'){
 await root.query(`INSERT INTO "AppointmentOrder"(id,"tenantId","officeId","customerId","appointmentDate","appointmentStartAt",status,"createdAt","updatedAt") VALUES($1,$2,$3,$4,'2038-06-01','2038-06-01T10:00Z',$5,$6,now())`,[id(name),t,office,id(customer),status,created])
 for(const code of codes)await root.query('INSERT INTO "AppointmentOrderCoupon"(id,"orderId",code) VALUES($1,$2,$3)',[id(name)+'_'+code,id(name),code])
}
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant])
 const initial=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id
 for(const [office,label]of[[a,'EAST'],[b,'WEST']])await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") SELECT $1,$2,"companyId",$3,$3,now() FROM "BusinessOffice" WHERE id=$4',[office,t,label,initial])
 for(const [user,r]of[[admin,'ADMIN'],[east,'MANAGER'],[west,'MANAGER'],[both,'MANAGER'],[none,'MANAGER'],...names.map(n=>[id(n),'CUSTOMER'])])await root.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||'@example.test',$3,now())`,[user,t,r])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,['appointments.read','appointmentCoupons.read']])
 for(const [user,offices]of[[east,[a]],[west,[b]],[both,[a,b]],[none,[]],[admin,[a,b]]]){
  if(user!==admin){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,user,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,user,role])}
  await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,1,now())',[t,user,offices[0]||null]);for(const office of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,user,office])
 }
 await root.query(`INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,'appointments',true,true,now())`,[t]);await root.query(`INSERT INTO "AppSetting"(id,"tenantId","timeZone","dateFormat","updatedAt") VALUES($1,$1,'Asia/Kolkata','dd/MM/yyyy',now())`,[t])
 await booking('order_used','used',a,['SAVE','VIP']);await booking('order_plain','plain',a);await booking('order_mixed','mixed',a)
 await booking('order_mixed_hidden','mixed',b,['PRIVATE']);await booking('order_hidden','hidden',b,['SECRET']);await booking('order_canceled','canceled',a,['VOID'],undefined,'CANCELED')
 await booking('order_before','before',a,['BEFORE'],'2036-02-03T18:29:59.999Z');await booking('order_boundary','boundary',a,['BOUNDARY'],'2036-02-03T18:30:00.000Z');await booking('order_after','after',a,['AFTER'],'2036-02-04T18:30:00.000Z')
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})
const period={dateFrom:'2036-02-04',dateTo:'2036-02-04'}
test('readable saved bookings define both views and all totals, excluding directory-only and hidden customers',async()=>{
 const used=await report(period);assert.deepEqual(used.summary,{totalCustomers:4,usedCustomers:2,notUsedCustomers:2,totalRedemptions:3});assert.deepEqual(used.items.map(x=>x.customerId).sort(),[id('used'),id('boundary')].sort());assert.equal(used.context.timeZone,'Asia/Kolkata')
 const unused=await report({...period,status:'not_used'});assert.deepEqual(unused.items.map(x=>x.customerId).sort(),[id('mixed'),id('plain')].sort());assert.deepEqual(unused.summary,used.summary)
 const data=JSON.stringify([used,unused]);for(const name of ['hidden','unbooked','canceled','before','after'])assert.ok(!data.includes(id(name)));assert.ok(!data.includes('PRIVATE'));assert.ok(!data.includes('SECRET'))
})
test('office selection narrows the union and never follows the creation preference',async()=>{
 const all=await report(period,both);assert.deepEqual(all.summary,{totalCustomers:5,usedCustomers:4,notUsedCustomers:1,totalRedemptions:5});assert.equal(all.context.office,null)
 const selected=await report({...period,officeId:b},both);assert.equal(selected.context.office.id,b);assert.equal(selected.total,2);assert.equal(selected.summary.totalRedemptions,2)
 assert.deepEqual((await report({...period,officeId:a},both)).summary,(await report(period)).summary)
 await root.query('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=$1,version=version+1 WHERE "tenantId"=$2 AND "userId"=$3',[b,t,both]);assert.deepEqual((await report(period,both)).summary,all.summary)
 await report({officeId:b},east,403);await report({officeId:'missing'},both,403)
 const foreign=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 LIMIT 1',[other])).rows[0].id;await report({officeId:foreign},both,403)
})
test('code search, pagination and details share the cohort, counting applications rather than bookings',async()=>{
 const data=await report({...period,couponCode:' save '});assert.equal(data.total,1);assert.equal(data.summary.totalCustomers,4);assert.equal(data.summary.totalRedemptions,1);assert.deepEqual(data.items[0].usedCouponCodes,['SAVE']);assert.equal(data.items[0].couponUsageCount,1)
 const multi=(await report({...period,q:id('used')})).items[0];assert.equal(multi.couponUsageCount,2);assert.equal(multi.distinctCouponCount,2);assert.deepEqual(multi.usedCouponCodes,['SAVE','VIP']);assert.equal(multi.lastCouponUsedAt,'2036-02-04T10:00:00.000Z')
 const page=await report({...period,page:'2',pageSize:'1'});assert.equal(page.total,2);assert.equal(page.items.length,1);assert.equal(page.totalPages,2);assert.equal(page.summary.totalCustomers,4)
 const hidden=await report({...period,q:id('hidden')});assert.equal(hidden.total,0);assert.equal(hidden.summary.totalCustomers,0)
 const unused=await report({...period,status:'not_used',couponCode:'PRIVATE'});assert.equal(unused.total,4);assert.ok(unused.items.every(x=>x.couponUsageCount===0&&x.lastCouponUsedAt===null))
})
test('tenant dates use booking creation rather than visit date, with DST boundaries exclusive',async()=>{
 assert.equal((await report(period)).summary.totalCustomers,4)
 await root.query(`UPDATE "AppSetting" SET "timeZone"='America/New_York' WHERE "tenantId"=$1`,[t]);try{
  await booking('dst_start','plain',a,['DST'],'2036-03-09T05:00:00Z');await booking('dst_last','plain',a,['DST'],'2036-03-10T03:59:59.999Z');await booking('dst_next','plain',a,['DST'],'2036-03-10T04:00:00Z')
  const data=await report({dateFrom:'2036-03-09',dateTo:'2036-03-09'});assert.equal(data.summary.totalRedemptions,2);assert.equal(data.items[0].lastCouponUsedAt,'2036-03-10T03:59:59.999Z')
 }finally{await root.query(`UPDATE "AppSetting" SET "timeZone"='Asia/Kolkata' WHERE "tenantId"=$1`,[t])}
})
test('closed offices retain history; no office access and revoked grants produce no source population',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[b]);try{assert.equal((await report({...period,officeId:b},both)).context.office.active,false)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[b])}
 assert.equal((await report(period,none)).summary.totalCustomers,0);await report({officeId:a},none,403)
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2',[t,east]);try{assert.equal((await report(period)).total,0)}finally{await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,east,a])}
})
test('both current permissions and active module/account are required, including direct service calls',async()=>{
 for(const permission of ['appointments.read','appointmentCoupons.read']){
  await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[[permission],role]);try{await report({},east,403);await assert.rejects(ctx(east,()=>couponUsageReport({tenantId:t,userId:east,role:'ADMIN',permissions:['appointments.read','appointmentCoupons.read']},couponReportQuery.parse({}))),e=>e.status===403)}finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[['appointments.read','appointmentCoupons.read'],role])}
 }
 await root.query(`UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key='appointments'`,[t]);try{await report({},east,403)}finally{await root.query(`UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key='appointments'`,[t])}
 await root.query(`UPDATE "User" SET status='SUSPENDED' WHERE id=$1`,[east]);try{await report({},east,403)}finally{await root.query(`UPDATE "User" SET status='ACTIVE' WHERE id=$1`,[east])}
})
test('read authorization is refreshed after waiting for a security writer',async()=>{
 await root.query('BEGIN');await root.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['workforce-schedules:'+t])
 const waiting=ctx(east,()=>couponUsageReport({tenantId:t,userId:east},couponReportQuery.parse(period))).then(value=>({value}),error=>({error}))
 try{
  let blocked=false
  for(let attempt=0;attempt<100;attempt++){
   await root.query("SELECT pg_stat_clear_snapshot()")
   blocked=(await root.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock_shared%' LIMIT 1")).rowCount>0
   if(blocked)break
   await new Promise(resolve=>setTimeout(resolve,50))
  }
  assert.equal(blocked,true,'report must reach the shared lock before revocation')
  await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[[],role]);await root.query('COMMIT')
  assert.equal((await waiting).error?.status,403,'permissions must be refreshed after the writer commits')
 }finally{await root.query('ROLLBACK');await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[['appointments.read','appointmentCoupons.read'],role]);await waiting}
})

test('invalid dates, reversed periods and oversized requests fail validation',async()=>{
 for(const params of [{dateFrom:'2036-02-31'},{dateTo:'9999-12-31'},{dateFrom:'2036-02-05',dateTo:'2036-02-04'},{page:'0'},{page:'10001'},{pageSize:'101'},{q:'x'.repeat(161)},{couponCode:'x'.repeat(41)},{officeId:''}])await report(params,east,400)
})
test('report reads leave saved bookings, prices and audits unchanged',async()=>{
 const fingerprint=async()=> (await root.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(o) ORDER BY id)::text,'')) value FROM "AppointmentOrder" o WHERE "tenantId"=$1`,[t])).rows[0].value
 const before=await fingerprint(),audits=(await root.query('SELECT count(*) n FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows[0].n
 await report(period);await report({...period,status:'not_used'},admin)
 assert.equal(await fingerprint(),before);assert.equal((await root.query('SELECT count(*) n FROM "AuditLog" WHERE "tenantId"=$1',[t])).rows[0].n,audits)
})
