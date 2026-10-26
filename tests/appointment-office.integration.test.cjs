/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TZ='UTC'
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg'),{AsyncLocalStorage}=require('node:async_hooks')
const raw=process.env.CRM_TEST_DATABASE_URL,url=new URL(raw||'http://invalid');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/ls_salon_crm_test')throw Error('Disposable local database only.')
const root=new Client({connectionString:raw}),sessions=new AsyncLocalStorage();url.username='crm_test_runtime';url.password='';process.env.DATABASE_URL=url.toString()
const authPath=require.resolve('../auth.ts');require.cache[authPath]={id:authPath,filename:authPath,loaded:true,exports:{auth:async()=>sessions.getStore()||null}}
const errors=[];require('../lib/logger.ts').logger.info=()=>{};require('../lib/logger.ts').logger.error=(_,c)=>errors.push(c.error?.message)
const {prisma,runWithTenantDbContext}=require('../lib/prisma.ts'),{runWithDatabaseActor}=require('../lib/database-actor.ts'),{defaultRecordRules,supportedScopes}=require('../platform/access/rules.ts')
const {appointmentTransaction}=require('../modules/appointments/appointment-transaction.ts'),{appointmentConflictSummary}=require('../modules/appointments/booking-integrity.ts')
const routes=Object.fromEntries(['','/[id]','/availability','/resolve','/orders','/orders/[id]','/orders/[id]/invoice','/orders/preview','/coupons/[id]','/staff-choices','/office-choices'].map(p=>[p,require(`../app/api/appointments${p}/route.ts`)]))
const t='booking_'+randomUUID().replaceAll('-',''),other=t+'_other',admin=t+'_admin',ma=t+'_ma',mb=t+'_mb',both=t+'_both',plain=t+'_plain',role=t+'_role',sa=t+'_sa',sb=t+'_sb',st=t+'_transfer',pa=t+'_pa',pb=t+'_pb',pt=t+'_pt',ca=t+'_ca',cb=t+'_cb',service=t+'_service'
let a,b,orderA,orderB,appointmentA,appointmentB
const ctx=(user,fn)=>runWithTenantDbContext(t,()=>runWithDatabaseActor(user,async()=>await fn()))
async function call(route='',method='GET',data,id,user=ma,office=a,version=5){return sessions.run({user:{id:user,tenantId:t,role:user===admin?'ADMIN':'MANAGER'}},()=>routes[route][method](new Request('http://'+t+'.localhost/api/appointments',{method,headers:{host:t+'.localhost','content-type':'application/json',...(office?{'x-office-id':office,'x-office-version':String(version)}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{params:Promise.resolve({id})}))}
async function body(response,status=200){const data=await response.json();assert.equal(response.status,status,JSON.stringify({data,errors:errors.slice(-2)}));return data}
const single=(staff=sa,customer=ca,day='2036-02-04',time='10:00')=>({staffId:staff,customerId:customer,serviceId:service,startAt:day+'T'+time+':00.000Z'})
const order=(staff=sa,customer=ca,day='2036-02-05',status='DRAFT')=>({customerId:customer,appointmentDate:day,appointmentStartTime:'10:00',appointmentStartAt:day+'T10:00:00.000Z',status,lines:[{staffId:staff,serviceId:service,quantity:1,durationMinutes:60,unitPriceCents:5000,discountType:'NONE',discountValue:0,taxIds:[],taxMode:'EXCLUSIVE'}],coupons:[],productLines:[]})
before(async()=>{
 await root.connect();for(const tenant of [t,other])await root.query('INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES($1,$1,$1,now())',[tenant]);const initial=(await root.query('SELECT id FROM "BusinessOffice" WHERE "tenantId"=$1 AND "isInitial"',[t])).rows[0].id;a=t+'_east';b=t+'_west'
 for(const [id,code]of[[a,'EAST'],[b,'WEST']])await root.query('INSERT INTO "BusinessOffice"(id,"tenantId","companyId",name,code,"updatedAt") SELECT $1,$2,"companyId",$3,$3,now() FROM "BusinessOffice" WHERE id=$4',[id,t,code,initial])
 for(const [id,r]of[[admin,'ADMIN'],[ma,'MANAGER'],[mb,'MANAGER'],[both,'MANAGER'],[plain,'MANAGER'],[sa,'STAFF'],[sb,'STAFF'],[st,'STAFF'],[ca,'CUSTOMER'],[cb,'CUSTOMER']])await root.query('INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$1,$1||\'@example.test\',$3,now())',[id,t,r])
 const rules=defaultRecordRules();for(const p of Object.keys(rules))if(supportedScopes(p.split('.')[0]).includes('ALL'))rules[p]='ALL'
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[role,t,['appointments.read','appointments.create','appointments.edit','appointments.archive','appointments.export','appointmentCoupons.read','appointmentCoupons.edit','services.read','reports.read']])
 for(const user of [ma,mb,both]){await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,user,rules]);await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,user,role])}
 for(const [user,offices]of[[admin,[a,b]],[ma,[a]],[mb,[b]],[both,[a,b]],[plain,[a]],[sa,[a]],[sb,[b]],[st,[a,b]]]){await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId","creationOfficeId",version,"updatedAt") VALUES($1,$2,$3,5,now())',[t,user,offices[0]]);for(const office of offices)await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,user,office])}
 for(const [profile,user]of[[pa,sa],[pb,sb],[pt,st]]){await root.query('INSERT INTO "StaffProfile"(id,"userId","schedulingMode","updatedAt") VALUES($1,$2,\'FLEXIBLE\',now())',[profile,user]);await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,profile])}
 for(const [profile,office,first,last]of[[pa,a,null,null],[pb,b,null,null],[pt,a,null,'2036-02-04'],[pt,b,'2036-02-05',null]])await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","startDate","endDate","updatedAt") VALUES($1,$2,$3,$4,$5,$6,now())',[profile+office,t,profile,office,first,last])
 for(const [profile,office]of[[pa,a],[pb,b]])for(let day=4;day<=10;day++)await root.query('INSERT INTO "StaffFlexibleAvailability"(id,"tenantId","officeId","staffProfileId",date,"startTime","endTime","updatedAt") VALUES($1,$2,$3,$4,$5,\'08:00\',\'18:00\',now())',[profile+day,t,office,profile,'2036-02-'+String(day).padStart(2,'0')])
 for(const key of ['appointments','services','shifts'])await root.query('INSERT INTO "TenantModule"("tenantId",key,allowed,enabled,"updatedAt") VALUES($1,$2,true,true,now())',[t,key]);await root.query('INSERT INTO "AppSetting"(id,"tenantId","timeZone","updatedAt") VALUES($1,$1,\'UTC\',now())',[t]);await root.query('INSERT INTO "ServiceCategory"(id,"tenantId",name,"updatedAt") VALUES($1,$2,\'Consultation category\',now())',[service,t]);await root.query('INSERT INTO "Service"(id,"tenantId","categoryId",name,"durationMinutes","priceCents","updatedAt") VALUES($1,$2,$1,\'Consultation\',60,5000,now())',[service,t])
})
after(async()=>{await root.end();await Promise.all([global.prisma,global.prismaBypassClient,...[...(global.prismaScopedClientCache?.values()||[])].map(e=>e.client)].filter(Boolean).map(c=>c.$disconnect()));await global.prismaPool?.end()})
test('new standalone appointments capture office/version and lists hide other offices',async()=>{
 appointmentA=(await body(await call('','POST',single()),201)).appointment
 appointmentB=(await body(await call('','POST',single(sb,cb),undefined,mb,b),201)).appointment
 assert.equal(appointmentA.officeId,a);assert.equal(appointmentB.officeId,b)
 assert.deepEqual((await body(await call())).items.map(x=>x.id),[appointmentA.id]);await body(await call('/[id]','GET',undefined,appointmentB.id),404)
 await body(await call('','POST',single(),undefined,ma,null),403)
 await root.query('UPDATE "BusinessOfficePolicy" SET version=6 WHERE "tenantId"=$1 AND "userId"=$2',[t,ma]);try{await body(await call('','POST',single(sa,ca,'2036-02-04','13:00')),409)}finally{await root.query('UPDATE "BusinessOfficePolicy" SET version=5 WHERE "tenantId"=$1 AND "userId"=$2',[t,ma])}
})
test('booking drafts/confirmed orders and every financial child inherit the source office',async()=>{
 orderA=(await body(await call('/orders','POST',order()),201)).order
 orderB=(await body(await call('/orders','POST',order(sb,cb,'2036-02-06','CONFIRMED'),undefined,mb,b),201)).order
 assert.equal(orderA.officeId,a);assert.equal(orderB.officeId,b)
 const linked=(await root.query('SELECT "officeId" FROM "Appointment" WHERE "orderLineId"=$1',[orderB.lines[0].id])).rows[0];assert.equal(linked.officeId,b)
 for(const tbl of ['appointmentOrder','appointmentOrderLine','appointmentOrderProductLine','appointmentOrderCoupon','appointmentOrderTax'])assert.equal(await ctx(ma,()=>prisma[tbl].count({where:tbl==='appointmentOrder'?{id:orderB.id}:{orderId:orderB.id}})),0)
 await body(await call('/orders/[id]','GET',undefined,orderB.id),404);await body(await call('/orders/[id]/invoice','GET',undefined,orderB.id),404)
})
test('editing an old order retains office even after workspace preference changes',async()=>{
 const before=(await root.query('SELECT "officeId","totalCents","invoiceBranding" FROM "AppointmentOrder" WHERE id=$1',[orderA.id])).rows[0]
 await root.query('UPDATE "BusinessOfficePolicy" SET "creationOfficeId"=$1,version=6 WHERE "tenantId"=$2 AND "userId"=$3',[b,t,both]);await body(await call('/orders/[id]','PATCH',{internalNote:'Source office retained'},orderA.id,both,null))
 assert.deepEqual((await root.query('SELECT "officeId","totalCents","invoiceBranding" FROM "AppointmentOrder" WHERE id=$1',[orderA.id])).rows[0],before)
})
test('new/expanded assignments require office grants and all tenant-calendar dates, including midnight',async()=>{
 await body(await call('','POST',single(sb,ca,'2036-02-04','14:00')),400)
 const check=(first,last)=>ctx(ma,()=>prisma.$queryRaw`SELECT app.booking_assignment_allowed(${t},${a},${pt},${new Date(first)}::timestamptz,${new Date(last)}::timestamptz) allowed`)
 assert.equal((await check('2036-02-04T23:00Z','2036-02-05T00:00Z'))[0].allowed,true);assert.equal((await check('2036-02-04T23:00Z','2036-02-05T00:01Z'))[0].allowed,false)
 await root.query('UPDATE "AppSetting" SET "timeZone"=\'Asia/Kolkata\' WHERE "tenantId"=$1',[t]);try{assert.equal((await check('2036-02-04T18:00Z','2036-02-04T19:00Z'))[0].allowed,false)}finally{await root.query('UPDATE "AppSetting" SET "timeZone"=\'UTC\' WHERE "tenantId"=$1',[t])}
})
test('bulk commands reject invisible selections atomically and partition readable audits by office',async()=>{
 await body(await call('/resolve','POST',{action:'cancel',appointmentIds:[appointmentA.id,appointmentB.id]}),404)
 assert.equal((await root.query('SELECT status FROM "Appointment" WHERE id=$1',[appointmentA.id])).rows[0].status,'SCHEDULED')
 await body(await call('/resolve','POST',{action:'cancel',appointmentIds:[appointmentA.id,appointmentB.id]},undefined,both,null))
 const logs=(await root.query('SELECT metadata,before FROM "AuditLog" WHERE "tenantId"=$1 AND event=\'appointment.bulk_canceled\'',[t])).rows
 assert.equal(logs.length,2);for(const row of logs){assert.equal(row.before.length,1);assert.equal(row.metadata.appointmentIds.length,1);assert.ok([a,b].includes(row.metadata.officeId))}
 const visible=await ctx(ma,()=>prisma.auditLog.findMany({where:{tenantId:t,event:'appointment.bulk_canceled'}}));assert.equal(visible.length,1);assert.ok(!JSON.stringify(visible).includes(appointmentB.id))
})
test('direct native writes reject forged offices, foreign identities and detached financial sources',async()=>{
 const actor={tenantId:t,userId:both,role:'MANAGER'}
 await assert.rejects(ctx(both,()=>appointmentTransaction(actor,'edit',tx=>tx.appointmentOrder.update({where:{id:orderA.id},data:{officeId:b}}))))
 await assert.rejects(ctx(both,()=>appointmentTransaction(actor,'edit',tx=>tx.appointmentOrderLine.update({where:{id:orderA.lines[0].id},data:{orderId:orderB.id}}))))
 await assert.rejects(ctx(both,()=>appointmentTransaction(actor,'edit',tx=>tx.appointmentOrder.update({where:{id:orderA.id},data:{customerId:'foreign'}}))))
})
test('closed office allows saved read/invoice export but rejects mutations and preserves prices',async()=>{
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a]);try{await body(await call('/orders/[id]','GET',undefined,orderA.id));const pdf=await call('/orders/[id]/invoice','GET',undefined,orderA.id);assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');await body(await call('/orders/[id]','PATCH',{internalNote:'Denied'},orderA.id),403);await body(await call('','POST',single(sa,ca,'2036-02-07')),403)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
})
test('hidden booking conflicts still block through the private integrity projection',async()=>{
 const hidden=(await root.query('SELECT id,"staffProfileId","customerId","startAt","endAt" FROM "Appointment" WHERE "orderLineId"=$1',[orderB.lines[0].id])).rows[0]
 const [summary]=await ctx(ma,()=>appointmentConflictSummary(prisma,t,[{staffProfileId:hidden.staffProfileId,startAt:hidden.startAt,endAt:hidden.endAt}]))
 assert.equal(summary.staffConflict,true);assert.ok(!JSON.stringify(summary).includes(hidden.id));assert.equal(await ctx(ma,()=>prisma.appointment.count({where:{id:hidden.id}})),0)
})
test('coupon limits and used-code rename protection count hidden offices without exposing their orders',async()=>{
 const coupon=t+'_coupon';await root.query('INSERT INTO "Coupon"(id,"tenantId",code,"discountType","discountValue","maxUses","updatedAt") VALUES($1,$2,\'HIDDENUSE\',\'AMOUNT\',100,1,now())',[coupon,t]);await root.query('INSERT INTO "AppointmentOrderCoupon"(id,"orderId",code,"discountType","discountValue","discountCents") VALUES($1,$2,\'HIDDENUSE\',\'AMOUNT\',100,100)',[coupon,orderB.id])
 assert.equal(await ctx(ma,()=>prisma.appointmentOrderCoupon.count({where:{code:'HIDDENUSE'}})),0)
 const usage=await ctx(ma,()=>prisma.$queryRaw`SELECT * FROM app.booking_coupon_usage(${t},ARRAY['HIDDENUSE'],${cb},NULL)`);assert.equal(usage[0].totalUses,1);assert.equal(usage[0].customerUses,1);assert.ok(!JSON.stringify(usage).includes(orderB.id))
 const payload=order(sa,ca,'2036-02-08');payload.coupons=['HIDDENUSE'];await body(await call('/orders','POST',payload),400)
 await body(await call('/coupons/[id]','PATCH',{code:'RENAMED'},coupon),409)
 await assert.rejects(ctx(ma,()=>prisma.$queryRaw`SELECT * FROM app.booking_coupon_usage(${t},ARRAY['HIDDENUSE'],${cb},${orderB.id})`))
})
test('role labels, module activation and current office revocation cannot grant booking read/write',async()=>{
 await body(await call('','GET',undefined,undefined,plain),403)
 await root.query('UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key=\'appointments\'',[t]);try{await body(await call(),403)}finally{await root.query('UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key=\'appointments\'',[t])}
 await root.query('DELETE FROM "BusinessOfficeGrant" WHERE "tenantId"=$1 AND "userId"=$2',[t,ma]);try{assert.equal((await body(await call())).total,0);await body(await call('/orders/[id]','GET',undefined,orderA.id),404)}finally{await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,ma,a])}
})

// A Create profile may build its own new order, but cannot append financial
// children to somebody else's existing source using the same command marker.
test('create-only profile cannot append to an old source and deferred links reject split updates',async()=>{
 const rules=defaultRecordRules();const createRole=t+'_create';
 await root.query('INSERT INTO "TenantAccessRole"(id,"tenantId",name,"nameKey",permissions,"updatedAt") VALUES($1,$2,$1,$1,$3,now())',[createRole,t,['appointments.read','appointments.create','services.read']]);
 await root.query('INSERT INTO "TenantUserAccess"("tenantId","userId",rules,"updatedAt") VALUES($1,$2,$3,now())',[t,plain,rules]);
 await root.query('INSERT INTO "TenantRoleAssignment"("tenantId","userId","roleId","updatedAt") VALUES($1,$2,$3,now())',[t,plain,createRole]);
 const created=(await body(await call('/orders','POST',order(sa,ca,'2036-02-09'),undefined,plain),201)).order;
 assert.equal(created.officeId,a);
 await assert.rejects(ctx(plain,()=>appointmentTransaction({tenantId:t,userId:plain,role:'MANAGER'},'create',tx=>tx.appointmentOrderTax.create({data:{orderId:orderA.id,name:'Forged tax',percent:1,taxCents:999}}))));
 const linked=(await root.query('SELECT id,"customerId" FROM "Appointment" WHERE "orderLineId"=$1',[orderB.lines[0].id])).rows[0];
 await assert.rejects(ctx(both,()=>appointmentTransaction({tenantId:t,userId:both,role:'MANAGER'},'edit',tx=>tx.appointment.update({where:{id:linked.id},data:{customerId:ca}}))));
 assert.equal((await root.query('SELECT "customerId" FROM "Appointment" WHERE id=$1',[linked.id])).rows[0].customerId,linked.customerId);
})
async function choices(path,params,user=ma,office=a,version=5){return sessions.run({user:{id:user,tenantId:t,role:user===admin?'ADMIN':'MANAGER'}},()=>routes[path].GET(new Request('http://'+t+'.localhost/api/appointments'+path+'?'+new URLSearchParams(params),{headers:{host:t+'.localhost',...(office?{'x-office-id':office,'x-office-version':String(version)}:{})}})))}
const window={family:'ORDER',action:'create',startAt:'2036-02-05T10:00:00Z',endAt:'2036-02-05T11:00:00Z'}
test('booking choices delegate only current office/date eligible staff without directory permissions',async()=>{
 const data=await body(await choices('/staff-choices',{...window,selected:sb+','+sa}));assert.equal(data.office.id,a);assert.ok(data.items.some(x=>x.id===sa));assert.ok(!JSON.stringify(data).includes(sb));assert.ok(!data.selected.some(x=>x.id===sb));assert.ok(!data.items.some(x=>x.id===st));
 await body(await choices('/staff-choices',window,ma,null),403);await body(await choices('/staff-choices',window,ma,a,999),409);
 const raw=await ctx(ma,()=>appointmentTransaction({tenantId:t,userId:ma,role:'MANAGER'},'create',tx=>tx.$queryRaw`SELECT app.booking_staff_choices(${t},'ORDER','create',NULL,NULL,'2036-02-05 10:00Z'::timestamptz,'2036-02-05 11:00Z'::timestamptz,ARRAY[]::text[],'',20,0) view`));assert.ok(raw[0].view.items.some(x=>x.id===sa));
})
test('source edits retain transferred staff while excluding them from new assignments',async()=>{
 await root.query(`UPDATE "StaffWorkplaceAssignment" SET "endDate"='2036-02-05' WHERE "staffProfileId"=$1`,[pb]);
 try{
  const data=await body(await choices('/staff-choices',{...window,action:'edit',sourceId:orderB.id,startAt:'2036-02-06T10:00:00Z',endAt:'2036-02-06T11:00:00Z',selected:sb},both,null));assert.equal(data.office.id,b);assert.equal(data.selected[0].id,sb);assert.equal(data.selected[0].retained,true);assert.equal(data.selected[0].eligible,false);
  await body(await choices('/staff-choices',{...window,action:'edit',sourceId:orderB.id,selected:sb}),404);
  const fresh=await body(await choices('/staff-choices',{...window,startAt:'2036-02-06T10:00:00Z',endAt:'2036-02-06T11:00:00Z',selected:sb},mb,b));assert.ok(!JSON.stringify(fresh).includes(sb));
 }finally{await root.query('UPDATE "StaffWorkplaceAssignment" SET "endDate"=NULL WHERE "staffProfileId"=$1',[pb])}
})
test('paged choice search and selected labels are bounded to the same office',async()=>{
 for(let i=0;i<105;i++){
  const id=t+'_choice_'+String(i).padStart(2,'0');await root.query(`INSERT INTO "User"(id,"tenantId",name,email,role,"updatedAt") VALUES($1,$2,$3,$1||'@example.test','STAFF',now())`,[id,t,'Choice '+String(i).padStart(2,'0')]);
  await root.query('INSERT INTO "BusinessOfficePolicy"("tenantId","userId",version,"updatedAt") VALUES($1,$2,1,now())',[t,id]);await root.query('INSERT INTO "BusinessOfficeGrant"("tenantId","userId","officeId") VALUES($1,$2,$3)',[t,id,a]);await root.query('INSERT INTO "StaffProfile"(id,"userId","updatedAt") VALUES($1,$1,now())',[id]);await root.query('INSERT INTO "StaffWorkplacePolicy"("tenantId","staffProfileId",version,"updatedAt") VALUES($1,$2,1,now())',[t,id]);await root.query('INSERT INTO "StaffWorkplaceAssignment"(id,"tenantId","staffProfileId","officeId","updatedAt") VALUES($1,$2,$1,$3,now())',[id,t,a]);
 }
 const second=await body(await choices('/staff-choices',{...window,q:'Choice ',page:'6',pageSize:'20',selected:t+'_choice_00,'+sb}));assert.equal(second.total,105);assert.equal(second.items.length,5);assert.deepEqual(second.selected.map(x=>x.id),[t+'_choice_00']);assert.ok(!JSON.stringify(second).includes(sb));
 const search=await body(await choices('/staff-choices',{...window,q:'Choice 24',selected:sa}));assert.equal(search.total,1);assert.equal(search.selected[0].id,sa);
})
test('office filters and browse labels narrow current readable sources and include closed history',async()=>{
 const offices=await body(await choices('/office-choices',{}));assert.deepEqual(offices.items.map(x=>x.id),[a]);const all=await body(await choices('/office-choices',{},both));assert.equal(all.total,2);
 const browse=await body(await choices('/staff-choices',{family:'APPOINTMENT',action:'browse',officeId:b,selected:sb}));assert.equal(browse.total,0);assert.deepEqual(browse.selected,[]);
 const same=await body(await choices('/staff-choices',{family:'APPOINTMENT',action:'browse',officeId:a,startDate:'2036-02-04',endDate:'2036-02-04',selected:sa}));assert.deepEqual(same.items.map(x=>x.id),[sa]);
 await root.query('UPDATE "BusinessOffice" SET archived=true WHERE id=$1',[a]);try{const closed=await body(await choices('/office-choices',{selected:a}));assert.equal(closed.selected.active,false);await body(await choices('/staff-choices',window),403)}finally{await root.query('UPDATE "BusinessOffice" SET archived=false WHERE id=$1',[a])}
 const list=async(path,params)=>sessions.run({user:{id:ma,tenantId:t,role:'MANAGER'}},()=>routes[path].GET(new Request('http://'+t+'.localhost/api/appointments?'+new URLSearchParams(params),{headers:{host:t+'.localhost'}})));
 assert.equal((await body(await list('',{officeId:b}))).total,0);assert.equal((await body(await list('/orders',{officeId:b}))).total,0);assert.ok((await body(await list('/orders',{officeId:a,staffId:sa}))).total>0);
})
test('choice endpoints recheck actions, activation and invalid windows',async()=>{
 const old=(await root.query('SELECT permissions FROM "TenantAccessRole" WHERE id=$1',[role])).rows[0].permissions;
 await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[old.filter(x=>x!=='appointments.create'),role]);try{await body(await choices('/staff-choices',window),403);await body(await choices('/staff-choices',{family:'ORDER',action:'browse'}))}finally{await root.query('UPDATE "TenantAccessRole" SET permissions=$1 WHERE id=$2',[old,role])}
 await body(await choices('/staff-choices',{...window,endAt:window.startAt}),400);await body(await choices('/staff-choices',{...window,selected:Array(101).fill(sa).join(',')}),400);
 await root.query(`UPDATE "TenantModule" SET enabled=false WHERE "tenantId"=$1 AND key='appointments'`,[t]);try{await body(await choices('/office-choices',{}),403);await body(await choices('/staff-choices',window),403)}finally{await root.query(`UPDATE "TenantModule" SET enabled=true WHERE "tenantId"=$1 AND key='appointments'`,[t])}
})
